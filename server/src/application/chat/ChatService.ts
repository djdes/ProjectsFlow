import type { Workspace, WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { ChatRepository, ListMessagesQuery } from './ChatRepository.js';
import type { ChatMessageRecord } from '../../domain/chat/ChatMessage.js';
import type { ChatMessageView, ChatReplyPreview } from '../../domain/chat/ChatMessageView.js';
import type { ChatReactionAggregate } from '../../domain/chat/ChatReaction.js';
import type { ChatAttachment } from '../../domain/chat/ChatAttachment.js';
import type { ChatEventHub } from '../../infrastructure/realtime/ChatEventHub.js';
import type { WorkspaceEventBroadcaster } from '../realtime/WorkspaceEventBroadcaster.js';
import type { DispatchChatMentionNotifications } from './DispatchChatMentionNotifications.js';
import {
  ChatMessageNotFoundError,
  NotMessageAuthorError,
  CannotDeleteMessageError,
  MessageDeletedError,
  EmptyMessageError,
  ChatAttachmentNotFoundError,
} from '../../domain/chat/errors.js';

// Доступ к пространству (подмножество WorkspaceRepository, нужное чату).
type WorkspaceAccess = {
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  getById(id: string): Promise<Workspace | null>;
};

export type ChatServiceDeps = {
  readonly repo: ChatRepository;
  readonly workspaces: WorkspaceAccess;
  readonly chatEventHub: ChatEventHub;
  readonly broadcaster: WorkspaceEventBroadcaster;
  readonly mentions: DispatchChatMentionNotifications;
  readonly idGen: () => string;
};

export type SendAttachmentDescriptor = {
  readonly storageKey: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width?: number | null;
  readonly height?: number | null;
};

export type SendMessageInput = {
  readonly body: string;
  readonly replyToId?: string | null;
  readonly attachments?: readonly SendAttachmentDescriptor[];
};

// Участник чат-комнаты (для поповера состава). email/avatarUrl приходят из join с users.
export type ChatParticipantView = {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
};

// Чат-комната в списке юзера: пространство, где он состоит + непрочитанное.
export type ChatRoomSummary = {
  readonly workspaceId: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly ownerUserId: string;
  readonly role: WorkspaceRole;
  readonly memberCount: number;
  readonly unreadCount: number;
  readonly lastMessageSeq: number;
};

const DEFAULT_PAGE = 40;
const MAX_PAGE = 100;

function excerpt(text: string, limit = 80): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

// @-mention против участников пространства (flat displayName). Возвращает уникальные
// user-id, исключая автора. Зеркало application/task/parseMentions, но по WorkspaceMember.
function parseChatMentions(
  body: string,
  members: readonly WorkspaceMember[],
  authorUserId: string,
): string[] {
  const lower = body.toLowerCase();
  const seen = new Set<string>();
  for (const m of members) {
    if (m.userId === authorUserId) continue;
    if (!m.displayName) continue;
    if (lower.includes(`@${m.displayName.toLowerCase()}`)) seen.add(m.userId);
  }
  return [...seen];
}

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  // ---------- read ----------
  async listMessages(
    workspaceId: string,
    userId: string,
    query: { beforeSeq?: number; afterSeq?: number; limit?: number },
  ): Promise<ChatMessageView[]> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const q: ListMessagesQuery = { limit };
    if (query.beforeSeq !== undefined) (q as { beforeSeq?: number }).beforeSeq = query.beforeSeq;
    if (query.afterSeq !== undefined) (q as { afterSeq?: number }).afterSeq = query.afterSeq;
    const records = await this.deps.repo.listMessages(workspaceId, q);
    return this.hydrate(records);
  }

  async getUnreadCount(workspaceId: string, userId: string): Promise<number> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    return this.deps.repo.countUnread(workspaceId, userId);
  }

  // Чат-комнаты юзера: все пространства, где он участник И там есть команда (memberCount>1)
  // ИЛИ есть сообщения. Это и решает баг «приглашённый не видит общий чат»: хаб владельца
  // (где лежит общий чат) попадает в список, т.к. приглашённый — его участник. Если ничего
  // не подошло — отдаём собственный дефолт-хаб (соло-юзеру есть куда писать). Сорт по свежести.
  async listRooms(userId: string): Promise<ChatRoomSummary[]> {
    const candidates = await this.deps.repo.listChatRoomsForUser(userId);
    let rooms = candidates.filter((r) => r.memberCount > 1 || r.messageCount > 0);
    if (rooms.length === 0) {
      const ownHub = candidates.find((r) => r.kind === 'default' && r.ownerUserId === userId);
      rooms = ownHub ? [ownHub] : [];
    }
    const withUnread = await Promise.all(
      rooms.map(async (r) => ({
        workspaceId: r.workspaceId,
        name: r.name,
        kind: r.kind,
        ownerUserId: r.ownerUserId,
        role: r.role,
        memberCount: r.memberCount,
        lastMessageSeq: r.lastMessageSeq,
        unreadCount: await this.deps.repo.countUnread(r.workspaceId, userId),
      })),
    );
    withUnread.sort((a, b) => b.lastMessageSeq - a.lastMessageSeq);
    return withUnread;
  }

  // Состав комнаты: все участники пространства (для поповера «кто в чате»). Доступ —
  // только участникам пространства (как и лента сообщений).
  async listParticipants(workspaceId: string, userId: string): Promise<ChatParticipantView[]> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const members = await this.deps.workspaces.listMembers(workspaceId);
    return members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName ?? '',
      email: m.email ?? null,
      avatarUrl: m.avatarUrl ?? null,
    }));
  }

  async markRead(workspaceId: string, userId: string, lastReadSeq: number): Promise<void> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    await this.deps.repo.setLastReadSeq(workspaceId, userId, Math.max(0, lastReadSeq));
  }

  // Гейт доступа для SSE-роута (роут сам делает replay/subscribe).
  async assertMember(workspaceId: string, userId: string): Promise<void> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
  }

  // ---------- write ----------
  async sendMessage(
    workspaceId: string,
    userId: string,
    input: SendMessageInput,
  ): Promise<ChatMessageView> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const body = input.body.trim();
    const attachments = input.attachments ?? [];
    if (!body && attachments.length === 0) throw new EmptyMessageError();

    const record = await this.deps.repo.insertMessage({
      id: this.deps.idGen(),
      workspaceId,
      authorUserId: userId,
      body,
      replyToId: input.replyToId ?? null,
    });

    for (const a of attachments) {
      await this.deps.repo.insertAttachment({
        id: this.deps.idGen(),
        messageId: record.id,
        storageKey: a.storageKey,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        width: a.width ?? null,
        height: a.height ?? null,
      });
    }

    const [view] = await this.hydrate([record]);
    this.deps.chatEventHub.publish(workspaceId, { kind: 'message_added', message: view! });

    // Лёгкое событие для бейджа непрочитанного у всех участников.
    void this.deps.broadcaster.broadcastChatChanged(workspaceId).catch(() => {});

    // @mentions → in-app уведомления (best-effort, не блокирует ответ).
    if (body) void this.dispatchMentions(workspaceId, userId, record, body).catch(() => {});

    return view!;
  }

  async editMessage(
    workspaceId: string,
    userId: string,
    messageId: string,
    body: string,
  ): Promise<ChatMessageView> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const msg = await this.loadInWorkspace(workspaceId, messageId);
    if (msg.deletedAt) throw new MessageDeletedError();
    if (msg.authorUserId !== userId) throw new NotMessageAuthorError();
    const trimmed = body.trim();
    if (!trimmed) throw new EmptyMessageError();

    await this.deps.repo.updateBody(messageId, trimmed, new Date());
    const updated = await this.deps.repo.getById(messageId);
    const [view] = await this.hydrate([updated!]);
    this.deps.chatEventHub.publish(workspaceId, { kind: 'message_edited', message: view! });
    return view!;
  }

  async deleteMessage(workspaceId: string, userId: string, messageId: string): Promise<void> {
    const member = await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const msg = await this.loadInWorkspace(workspaceId, messageId);
    if (msg.deletedAt) return; // идемпотентно
    const isAuthor = msg.authorUserId === userId;
    const isOwner = member.role === 'owner';
    if (!isAuthor && !isOwner) throw new CannotDeleteMessageError();

    await this.deps.repo.softDelete(messageId, new Date());
    this.deps.chatEventHub.publish(workspaceId, {
      kind: 'message_deleted',
      messageId,
      seq: msg.seq,
    });
  }

  async toggleReaction(
    workspaceId: string,
    userId: string,
    messageId: string,
    emoji: string,
    add: boolean,
  ): Promise<void> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const msg = await this.loadInWorkspace(workspaceId, messageId);
    if (msg.deletedAt) throw new MessageDeletedError();

    if (add) await this.deps.repo.addReaction(messageId, userId, emoji);
    else await this.deps.repo.removeReaction(messageId, userId, emoji);

    const reactions = this.aggregateReactions(await this.deps.repo.listReactions([messageId]));
    this.deps.chatEventHub.publish(workspaceId, {
      kind: 'reaction_changed',
      messageId,
      reactions: reactions.get(messageId) ?? [],
    });
  }

  // Авторизация скачивания вложения: участник пространства + вложение принадлежит
  // сообщению этого пространства. Бинарь читает роут (через AttachmentStorage).
  async authorizeAttachment(
    workspaceId: string,
    userId: string,
    attachmentId: string,
  ): Promise<ChatAttachment> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const att = await this.deps.repo.getAttachment(attachmentId);
    if (!att) throw new ChatAttachmentNotFoundError(attachmentId);
    const msg = await this.deps.repo.getById(att.messageId);
    if (!msg || msg.workspaceId !== workspaceId) throw new ChatAttachmentNotFoundError(attachmentId);
    return att;
  }

  // ---------- helpers ----------
  private async loadInWorkspace(workspaceId: string, messageId: string): Promise<ChatMessageRecord> {
    const msg = await this.deps.repo.getById(messageId);
    if (!msg || msg.workspaceId !== workspaceId) throw new ChatMessageNotFoundError(messageId);
    return msg;
  }

  private async dispatchMentions(
    workspaceId: string,
    actorUserId: string,
    record: ChatMessageRecord,
    body: string,
  ): Promise<void> {
    const members = await this.deps.workspaces.listMembers(workspaceId);
    const mentionedUserIds = parseChatMentions(body, members, actorUserId);
    if (mentionedUserIds.length === 0) return;
    const ws = await this.deps.workspaces.getById(workspaceId);
    await this.deps.mentions.execute({
      workspaceId,
      workspaceName: ws?.name ?? 'Пространство',
      messageId: record.id,
      messageSeq: record.seq,
      messageExcerpt: excerpt(body),
      actorUserId,
      actorDisplayName: record.authorDisplayName,
      mentionedUserIds,
    });
  }

  private async hydrate(records: readonly ChatMessageRecord[]): Promise<ChatMessageView[]> {
    if (records.length === 0) return [];
    const ids = records.map((r) => r.id);
    const replyIds = [...new Set(records.map((r) => r.replyToId).filter((x): x is string => !!x))];

    const [reactionRows, attachmentRows, replyTargets] = await Promise.all([
      this.deps.repo.listReactions(ids),
      this.deps.repo.listAttachments(ids),
      replyIds.length > 0 ? this.deps.repo.getByIds(replyIds) : Promise.resolve([]),
    ]);

    const reactionsByMsg = this.aggregateReactions(reactionRows);
    const attachmentsByMsg = new Map<string, ChatAttachment[]>();
    for (const a of attachmentRows) {
      const arr = attachmentsByMsg.get(a.messageId) ?? [];
      arr.push(a);
      attachmentsByMsg.set(a.messageId, arr);
    }
    const replyById = new Map<string, ChatReplyPreview>();
    for (const t of replyTargets) {
      replyById.set(t.id, {
        id: t.id,
        authorDisplayName: t.authorDisplayName,
        excerpt: t.deletedAt ? 'Сообщение удалено' : excerpt(t.body, 60),
        deleted: t.deletedAt != null,
      });
    }

    return records.map((r) => {
      const deleted = r.deletedAt != null;
      return {
        id: r.id,
        seq: r.seq,
        workspaceId: r.workspaceId,
        authorUserId: r.authorUserId,
        authorDisplayName: r.authorDisplayName,
        authorAvatarUrl: r.authorAvatarUrl,
        body: deleted ? '' : r.body,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt ? r.editedAt.toISOString() : null,
        deleted,
        replyTo: r.replyToId ? (replyById.get(r.replyToId) ?? null) : null,
        reactions: deleted ? [] : (reactionsByMsg.get(r.id) ?? []),
        attachments: deleted ? [] : (attachmentsByMsg.get(r.id) ?? []),
      } satisfies ChatMessageView;
    });
  }

  private aggregateReactions(
    rows: readonly { messageId: string; userId: string; emoji: string }[],
  ): Map<string, ChatReactionAggregate[]> {
    // messageId → emoji → userIds
    const byMsg = new Map<string, Map<string, string[]>>();
    for (const r of rows) {
      let byEmoji = byMsg.get(r.messageId);
      if (!byEmoji) {
        byEmoji = new Map();
        byMsg.set(r.messageId, byEmoji);
      }
      const arr = byEmoji.get(r.emoji) ?? [];
      arr.push(r.userId);
      byEmoji.set(r.emoji, arr);
    }
    const out = new Map<string, ChatReactionAggregate[]>();
    for (const [messageId, byEmoji] of byMsg) {
      const aggs: ChatReactionAggregate[] = [];
      for (const [emoji, userIds] of byEmoji) {
        aggs.push({ emoji, count: userIds.length, userIds });
      }
      out.set(messageId, aggs);
    }
    return out;
  }
}
