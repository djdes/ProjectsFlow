import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatService } from './ChatService.js';
import type { ChatRepository, ChatRoomRow, InsertMessageInput, InsertAttachmentInput, ListMessagesQuery } from './ChatRepository.js';
import type { ChatServiceDeps } from './ChatService.js';
import type { ChatMessageRecord } from '../../domain/chat/ChatMessage.js';
import type { ChatReaction } from '../../domain/chat/ChatReaction.js';
import type { ChatAttachment } from '../../domain/chat/ChatAttachment.js';
import type { ChatStreamEvent } from '../../domain/chat/ChatEvent.js';
import type { Workspace } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  NotMessageAuthorError,
  CannotDeleteMessageError,
  EmptyMessageError,
} from '../../domain/chat/errors.js';
import { WorkspaceNotFoundError } from '../../domain/workspace/errors.js';

const WS = 'ws-1';

type Seed = {
  members: Array<{ userId: string; role: WorkspaceRole; displayName?: string }>;
};

function makeService(seed: Seed) {
  // --- in-memory chat repo ---
  const messages = new Map<string, ChatMessageRecord>();
  const reactions: ChatReaction[] = [];
  const attachments: ChatAttachment[] = [];
  const reads = new Map<string, number>(); // `${ws}:${user}` -> seq
  let seq = 0;
  let idSeq = 0;

  const nameOf = (userId: string): string =>
    seed.members.find((m) => m.userId === userId)?.displayName ?? userId;

  const repo: ChatRepository = {
    async insertMessage(input: InsertMessageInput) {
      seq += 1;
      const rec: ChatMessageRecord = {
        id: input.id,
        seq,
        workspaceId: input.workspaceId,
        authorUserId: input.authorUserId,
        body: input.body,
        replyToId: input.replyToId,
        createdAt: new Date('2026-06-23T10:00:00Z'),
        editedAt: null,
        deletedAt: null,
        authorDisplayName: nameOf(input.authorUserId),
        authorAvatarUrl: null,
      };
      messages.set(rec.id, rec);
      return rec;
    },
    async getById(id) {
      return messages.get(id) ?? null;
    },
    async getByIds(ids) {
      return ids.map((i) => messages.get(i)).filter((m): m is ChatMessageRecord => !!m);
    },
    async listMessages(workspaceId, query: ListMessagesQuery) {
      let all = [...messages.values()].filter((m) => m.workspaceId === workspaceId);
      all.sort((a, b) => a.seq - b.seq);
      if (query.afterSeq !== undefined) all = all.filter((m) => m.seq > query.afterSeq!);
      if (query.beforeSeq !== undefined) all = all.filter((m) => m.seq < query.beforeSeq!);
      return all.slice(-query.limit);
    },
    async updateBody(id, body, editedAt) {
      const m = messages.get(id);
      if (m) messages.set(id, { ...m, body, editedAt });
    },
    async softDelete(id, deletedAt) {
      const m = messages.get(id);
      if (m) messages.set(id, { ...m, deletedAt, body: '' });
    },
    async addReaction(messageId, userId, emoji) {
      if (!reactions.some((r) => r.messageId === messageId && r.userId === userId && r.emoji === emoji)) {
        reactions.push({ messageId, userId, emoji });
      }
    },
    async removeReaction(messageId, userId, emoji) {
      const i = reactions.findIndex((r) => r.messageId === messageId && r.userId === userId && r.emoji === emoji);
      if (i >= 0) reactions.splice(i, 1);
    },
    async listReactions(messageIds) {
      return reactions.filter((r) => messageIds.includes(r.messageId));
    },
    async insertAttachment(input: InsertAttachmentInput) {
      const att: ChatAttachment = { ...input, width: input.width, height: input.height };
      attachments.push(att);
      return att;
    },
    async getAttachment(id) {
      return attachments.find((a) => a.id === id) ?? null;
    },
    async listAttachments(messageIds) {
      return attachments.filter((a) => messageIds.includes(a.messageId));
    },
    async getLastReadSeq(workspaceId, userId) {
      return reads.get(`${workspaceId}:${userId}`) ?? 0;
    },
    async setLastReadSeq(workspaceId, userId, s) {
      reads.set(`${workspaceId}:${userId}`, s);
    },
    async countUnread(workspaceId, userId) {
      const last = reads.get(`${workspaceId}:${userId}`) ?? 0;
      return [...messages.values()].filter(
        (m) => m.workspaceId === workspaceId && m.seq > last && m.authorUserId !== userId && !m.deletedAt,
      ).length;
    },
    async maxSeq() {
      return seq;
    },
    async listChatRoomsForUser() {
      return [];
    },
  };

  // --- workspace access fake ---
  const workspaces = {
    async getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
      const m = seed.members.find((x) => x.userId === userId);
      return m ? { workspaceId, userId, role: m.role } : null;
    },
    async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
      return seed.members.map((m) => ({ workspaceId, userId: m.userId, role: m.role, displayName: m.displayName }));
    },
    async getById(): Promise<Workspace | null> {
      return { id: WS, name: 'Team', icon: null, kind: 'team', ownerUserId: 'owner', createdAt: new Date('2026-01-01') };
    },
  };

  const events: ChatStreamEvent[] = [];
  const mentioned: string[][] = [];

  const service = new ChatService({
    repo,
    workspaces,
    chatEventHub: { publish: (_ws, e) => events.push(e), subscribe: () => () => {} },
    broadcaster: { async broadcastChatChanged() {} },
    mentions: { async execute(input) { mentioned.push([...input.mentionedUserIds]); } },
    idGen: () => `m-${++idSeq}`,
  });

  return { service, events, mentioned, repo };
}

test('sendMessage: участник может отправить, событие message_added публикуется', async () => {
  const { service, events } = makeService({ members: [{ userId: 'u1', role: 'editor' }] });
  const view = await service.sendMessage(WS, 'u1', { body: 'Привет' });
  assert.equal(view.body, 'Привет');
  assert.equal(view.seq, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'message_added');
});

test('sendMessage: не участник — WorkspaceNotFoundError (не разглашаем)', async () => {
  const { service } = makeService({ members: [{ userId: 'u1', role: 'editor' }] });
  await assert.rejects(() => service.sendMessage(WS, 'stranger', { body: 'hi' }), WorkspaceNotFoundError);
});

test('sendMessage: пустое тело без вложений — EmptyMessageError', async () => {
  const { service } = makeService({ members: [{ userId: 'u1', role: 'editor' }] });
  await assert.rejects(() => service.sendMessage(WS, 'u1', { body: '   ' }), EmptyMessageError);
});

test('editMessage: только автор', async () => {
  const { service } = makeService({
    members: [{ userId: 'u1', role: 'editor' }, { userId: 'u2', role: 'editor' }],
  });
  const msg = await service.sendMessage(WS, 'u1', { body: 'mine' });
  await assert.rejects(() => service.editMessage(WS, 'u2', msg.id, 'hacked'), NotMessageAuthorError);
  const edited = await service.editMessage(WS, 'u1', msg.id, 'edited');
  assert.equal(edited.body, 'edited');
  assert.notEqual(edited.editedAt, null);
});

test('deleteMessage: чужое удаляет owner, но не обычный member', async () => {
  const { service } = makeService({
    members: [{ userId: 'author', role: 'editor' }, { userId: 'mem', role: 'editor' }, { userId: 'own', role: 'owner' }],
  });
  const msg = await service.sendMessage(WS, 'author', { body: 'x' });
  await assert.rejects(() => service.deleteMessage(WS, 'mem', msg.id), CannotDeleteMessageError);
  await service.deleteMessage(WS, 'own', msg.id); // owner-модерация — ок
  const [view] = await service.listMessages(WS, 'own', {});
  assert.equal(view?.deleted, true);
  assert.equal(view?.body, '');
});

test('toggleReaction: агрегат собирается, reaction_changed публикуется', async () => {
  const { service, events } = makeService({
    members: [{ userId: 'u1', role: 'editor' }, { userId: 'u2', role: 'editor' }],
  });
  const msg = await service.sendMessage(WS, 'u1', { body: 'react me' });
  await service.toggleReaction(WS, 'u1', msg.id, '👍', true);
  await service.toggleReaction(WS, 'u2', msg.id, '👍', true);
  const [view] = await service.listMessages(WS, 'u1', {});
  const thumbs = view?.reactions.find((r) => r.emoji === '👍');
  assert.equal(thumbs?.count, 2);
  assert.deepEqual([...(thumbs?.userIds ?? [])].sort(), ['u1', 'u2']);
  assert.ok(events.some((e) => e.kind === 'reaction_changed'));
});

test('unread: считает чужие непрочитанные, markRead обнуляет', async () => {
  const { service } = makeService({
    members: [{ userId: 'u1', role: 'editor' }, { userId: 'u2', role: 'editor' }],
  });
  await service.sendMessage(WS, 'u2', { body: 'a' });
  const m2 = await service.sendMessage(WS, 'u2', { body: 'b' });
  assert.equal(await service.getUnreadCount(WS, 'u1'), 2);
  await service.markRead(WS, 'u1', m2.seq);
  assert.equal(await service.getUnreadCount(WS, 'u1'), 0);
});

test('mentions: @displayName упомянутого попадает в dispatch', async () => {
  const { service, mentioned } = makeService({
    members: [{ userId: 'u1', role: 'editor', displayName: 'Аня' }, { userId: 'u2', role: 'editor', displayName: 'Боря' }],
  });
  await service.sendMessage(WS, 'u1', { body: 'привет @Боря смотри' });
  // dispatch — best-effort (void); даём микротаскам отработать.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(mentioned.at(-1), ['u2']);
});

test('reply: replyTo превью отдаётся с excerpt', async () => {
  const { service } = makeService({ members: [{ userId: 'u1', role: 'editor', displayName: 'Аня' }] });
  const first = await service.sendMessage(WS, 'u1', { body: 'исходное' });
  await service.sendMessage(WS, 'u1', { body: 'ответ', replyToId: first.id });
  const list = await service.listMessages(WS, 'u1', {});
  const reply = list.find((m) => m.replyTo);
  assert.equal(reply?.replyTo?.id, first.id);
  assert.equal(reply?.replyTo?.excerpt, 'исходное');
});

// --- listRooms: какие чат-комнаты видит юзер (фикс бага «приглашённый не видит общий чат») ---

function row(over: Partial<ChatRoomRow> & { workspaceId: string }): ChatRoomRow {
  return {
    name: over.workspaceId,
    kind: 'team',
    ownerUserId: 'someone',
    role: 'editor',
    memberCount: 1,
    messageCount: 0,
    lastMessageSeq: 0,
    ...over,
  };
}

function roomsService(rows: ChatRoomRow[], unread: Record<string, number> = {}) {
  const repo = {
    async listChatRoomsForUser() {
      return rows;
    },
    async countUnread(ws: string) {
      return unread[ws] ?? 0;
    },
  } as unknown as ChatRepository;
  return new ChatService({
    repo,
    workspaces: { async getMembership() { return null; }, async listMembers() { return []; }, async getById() { return null; } },
    chatEventHub: { publish() {}, subscribe: () => () => {} },
    broadcaster: { async broadcastChatChanged() {} },
    mentions: { async execute() {} },
    idGen: () => 'x',
  } as unknown as ChatServiceDeps);
}

test('listRooms: показывает хаб владельца с командой, скрывает пустой соло-хаб приглашённого', async () => {
  // У приглашённого Ярослава: его собственный пустой дефолт-хаб (mc=1, без сообщений) + хаб
  // Дениса, куда его позвали (mc=4). Должен увидеть только хаб Дениса.
  const service = roomsService([
    row({ workspaceId: 'hubYaroslav', kind: 'default', ownerUserId: 'yaroslav', role: 'owner', memberCount: 1 }),
    row({ workspaceId: 'hubDenis', kind: 'default', ownerUserId: 'denis', role: 'editor', memberCount: 4, messageCount: 5, lastMessageSeq: 5 }),
  ]);
  const rooms = await service.listRooms('yaroslav');
  assert.deepEqual(rooms.map((r) => r.workspaceId), ['hubDenis']);
});

test('listRooms: владелец видит свой хаб (есть команда)', async () => {
  const service = roomsService([
    row({ workspaceId: 'hubDenis', kind: 'default', ownerUserId: 'denis', role: 'owner', memberCount: 4, messageCount: 5, lastMessageSeq: 5 }),
  ]);
  const rooms = await service.listRooms('denis');
  assert.deepEqual(rooms.map((r) => r.workspaceId), ['hubDenis']);
  assert.equal(rooms[0]?.role, 'owner');
});

test('listRooms: соло-юзер без команды/сообщений → fallback на собственный дефолт-хаб', async () => {
  const service = roomsService([
    row({ workspaceId: 'hubSolo', kind: 'default', ownerUserId: 'solo', role: 'owner', memberCount: 1 }),
  ]);
  const rooms = await service.listRooms('solo');
  assert.deepEqual(rooms.map((r) => r.workspaceId), ['hubSolo']);
});

test('listRooms: несколько комнат — сортировка по свежести + unread прикрепляется', async () => {
  const service = roomsService(
    [
      row({ workspaceId: 'wsA', memberCount: 3, messageCount: 2, lastMessageSeq: 10 }),
      row({ workspaceId: 'wsB', memberCount: 2, messageCount: 9, lastMessageSeq: 99 }),
    ],
    { wsA: 1, wsB: 7 },
  );
  const rooms = await service.listRooms('u');
  assert.deepEqual(rooms.map((r) => r.workspaceId), ['wsB', 'wsA']); // по lastMessageSeq desc
  assert.equal(rooms.find((r) => r.workspaceId === 'wsB')?.unreadCount, 7);
  assert.equal(rooms.find((r) => r.workspaceId === 'wsA')?.unreadCount, 1);
});
