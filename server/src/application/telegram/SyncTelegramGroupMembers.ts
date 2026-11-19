import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { TelegramGroupNotFoundError } from '../../domain/telegram/errors.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import { requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { TelegramClient } from './TelegramClient.js';
import type {
  LinkedTelegramGroupMember,
  TelegramGroupMemberRepository,
  TelegramGroupMemberSource,
  TelegramGroupMemberStatus,
} from './TelegramGroupMemberRepository.js';
import type { TelegramWorkGroup, TelegramWorkGroupRepository } from './TelegramWorkGroupRepository.js';

// Повторное сообщение того же автора в той же группе раньше этого срока БД не трогает: в
// активной группе пишут часто, а нового о человеке оно не скажет.
const DEFAULT_MESSAGE_THROTTLE_MS = 10 * 60 * 1000;
// «Бот — администратор группы?» спрашиваем у Telegram не чаще раза в 10 минут на группу.
const BOT_ADMIN_TTL_MS = 10 * 60 * 1000;
const THROTTLE_MAX_KEYS = 5_000;

const ADMIN_STATUSES = new Set(['creator', 'administrator']);
const GONE_STATUSES = new Set(['left', 'kicked']);
const LEAD_ROLES: ReadonlySet<WorkspaceRole> = new Set<WorkspaceRole>(['owner', 'lead']);

type Deps = {
  readonly repo: TelegramGroupMemberRepository;
  readonly groups: Pick<TelegramWorkGroupRepository, 'findByChat'>;
  readonly workspaces: {
    getById(id: string): Promise<{ id: string; name: string; kind: WorkspaceKind } | null>;
    getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
    listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
    addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
    wasRemoved(workspaceId: string, userId: string): Promise<boolean>;
  };
  readonly users: { findUserIdByTelegramUserId(telegramUserId: number): Promise<string | null> };
  readonly notifications: Pick<NotificationRepository, 'create'>;
  readonly telegram: Pick<TelegramClient, 'getChatAdministrators'>;
  readonly botUsername: string | null;
  readonly idGen: () => string;
  readonly now: () => Date;
  readonly messageThrottleMs?: number;
};

export type TelegramGroupMembersSummary = {
  // Сколько участников группы знает бот (кроме вышедших).
  readonly telegramCount: number;
  // Из них — с привязанным аккаунтом PF.
  readonly linked: readonly LinkedTelegramGroupMember[];
  // false — бот не администратор: события chat_member не приходят (подсказка в карточке);
  // null — узнать не удалось (или группа не активна).
  readonly botIsAdmin: boolean | null;
};

/**
 * Участники рабочих Telegram-групп (db/191, spec 2026-11-17 §4). Полного списка Telegram не
 * даёт: собираем администраторов (снимок при подключении), события chat_member, вступления и
 * авторов сообщений. Человек с аккаунтом PF молча добавляется в пространство группы
 * редактором (владельцы/руководители получают уведомление): кто уже в пространстве — роль не
 * меняется; кого руководитель удалил — не возвращается; вышедший из группы остаётся в
 * пространстве. Работает только для активных групп, в обоих режимах (standard и incident).
 */
export class SyncTelegramGroupMembers {
  private readonly recentAuthors = new Map<string, number>();
  private readonly botAdmin = new Map<number, { readonly value: boolean; readonly at: number }>();
  // Один и тот же человек может прийти двумя апдейтами сразу — уведомление руководителю одно.
  private readonly adding = new Set<string>();

  constructor(private readonly deps: Deps) {}

  // Группа стала активной (подключена кодом, вручную, подтверждён черновик, перенесена) или
  // бот получил права администратора: снимок администраторов. Возвращает «бот — админ?».
  async snapshotAdmins(chatId: number): Promise<boolean | null> {
    const group = await this.activeGroup(chatId);
    if (!group) return null;
    const admins = await this.deps.telegram.getChatAdministrators?.(chatId).catch(() => null);
    if (!admins) return null;
    const bot = this.botUsername();
    const botIsAdmin = admins.some((a) => a.isBot === true && !!bot && a.username?.toLowerCase() === bot);
    this.botAdmin.set(chatId, { value: botIsAdmin, at: this.deps.now().getTime() });
    for (const admin of admins) {
      if (admin.isBot || !ADMIN_STATUSES.has(admin.status)) continue;
      await this.record(group, admin.userId, 'admins', 'admin');
    }
    return botIsAdmin;
  }

  // Автор сообщения в группе.
  async recordMessageAuthor(chatId: number, tgUserId: number): Promise<void> {
    const key = `${chatId}:${tgUserId}`;
    const now = this.deps.now().getTime();
    const last = this.recentAuthors.get(key);
    if (last !== undefined && now - last < (this.deps.messageThrottleMs ?? DEFAULT_MESSAGE_THROTTLE_MS)) return;
    if (this.recentAuthors.size >= THROTTLE_MAX_KEYS) this.recentAuthors.clear();
    this.recentAuthors.set(key, now);
    const group = await this.activeGroup(chatId);
    if (!group) return;
    await this.record(group, tgUserId, 'message');
  }

  // Событие chat_member (бот — администратор группы) или сервисные new_chat_members /
  // left_chat_member. telegramStatus — статус Telegram: creator | administrator | member |
  // restricted | left | kicked.
  async handleMemberUpdate(
    chatId: number,
    tgUserId: number,
    telegramStatus: string,
    opts: { readonly isMember?: boolean } = {},
  ): Promise<void> {
    const status = toMemberStatus(telegramStatus, opts.isMember);
    if (!status) return;
    // Вернувшийся напишет — запись обновится сразу, а не через окно троттлинга.
    this.recentAuthors.delete(`${chatId}:${tgUserId}`);
    const group = await this.activeGroup(chatId);
    if (!group) return;
    await this.record(group, tgUserId, 'join', status);
  }

  // Бот стал администратором группы или перестал им быть (my_chat_member).
  async handleBotRightsChanged(chatId: number, botIsAdmin: boolean): Promise<void> {
    this.botAdmin.set(chatId, { value: botIsAdmin, at: this.deps.now().getTime() });
    if (botIsAdmin) await this.snapshotAdmins(chatId);
  }

  async summary(workspaceId: string, actorUserId: string, chatId: number): Promise<TelegramGroupMembersSummary> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    const group = await this.deps.groups.findByChat(chatId);
    if (!group || group.workspaceId !== workspaceId) throw new TelegramGroupNotFoundError();
    let botIsAdmin: boolean | null = null;
    if (group.status === 'active') {
      const cached = this.botAdmin.get(chatId);
      // Устаревшее значение — заодно освежаем снимок администраторов.
      botIsAdmin =
        cached && this.deps.now().getTime() - cached.at < BOT_ADMIN_TTL_MS
          ? cached.value
          : await this.snapshotAdmins(chatId);
    }
    const { telegramCount, linked } = await this.deps.repo.summary(chatId);
    return { telegramCount, linked, botIsAdmin };
  }

  private async record(
    group: TelegramWorkGroup,
    tgUserId: number,
    source: TelegramGroupMemberSource,
    status?: TelegramGroupMemberStatus,
  ): Promise<void> {
    await this.deps.repo.upsert({
      chatId: group.chatId,
      tgUserId,
      source,
      ...(status ? { status } : {}),
      seenAt: this.deps.now(),
    });
    // Вышел из группы — из пространства не удаляем (решение владельца).
    if (status === 'left') return;
    await this.addToWorkspace(group, tgUserId);
  }

  private async addToWorkspace(group: TelegramWorkGroup, tgUserId: number): Promise<void> {
    // Без аккаунта PF (в incident-режиме так пишет большинство) — только запись участника.
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) return;
    const key = `${group.workspaceId}:${userId}`;
    if (this.adding.has(key)) return;
    this.adding.add(key);
    try {
      // Уже в пространстве — роль не трогаем.
      if (await this.deps.workspaces.getMembership(group.workspaceId, userId)) return;
      // Удалён руководителем — сам через группу не возвращается.
      if (await this.deps.workspaces.wasRemoved(group.workspaceId, userId)) return;
      const workspace = await this.deps.workspaces.getById(group.workspaceId);
      if (!workspace || workspace.kind !== 'team') return;
      await this.deps.workspaces.addMember(group.workspaceId, userId, 'editor');
      await this.notifyLeads(group, workspace.name, userId);
    } finally {
      this.adding.delete(key);
    }
  }

  private async notifyLeads(group: TelegramWorkGroup, workspaceName: string, memberUserId: string): Promise<void> {
    const members = await this.deps.workspaces.listMembers(group.workspaceId);
    const memberDisplayName = members.find((m) => m.userId === memberUserId)?.displayName ?? 'Участник';
    const leads = members.filter((m) => LEAD_ROLES.has(m.role) && m.userId !== memberUserId);
    await Promise.all(
      leads.map((lead) =>
        this.deps.notifications
          .create({
            id: this.deps.idGen(),
            userId: lead.userId,
            payload: {
              type: 'telegram_group_member_added',
              workspaceId: group.workspaceId,
              workspaceName,
              groupChatId: group.chatId,
              groupTitle: group.title,
              memberUserId,
              memberDisplayName,
            },
          })
          .catch((err: unknown) => {
            console.warn('[tg-group-members] lead notification failed:', err);
          }),
      ),
    );
  }

  private async activeGroup(chatId: number): Promise<TelegramWorkGroup | null> {
    const group = await this.deps.groups.findByChat(chatId);
    return group && group.status === 'active' ? group : null;
  }

  private botUsername(): string | null {
    const bot = this.deps.botUsername?.replace(/^@/, '').trim().toLowerCase();
    return bot || null;
  }
}

function toMemberStatus(telegramStatus: string, isMember: boolean | undefined): TelegramGroupMemberStatus | null {
  if (ADMIN_STATUSES.has(telegramStatus)) return 'admin';
  if (telegramStatus === 'member') return 'member';
  if (GONE_STATUSES.has(telegramStatus)) return 'left';
  // restricted: в группе, пока is_member не false.
  if (telegramStatus === 'restricted') return isMember === false ? 'left' : 'member';
  return null;
}
