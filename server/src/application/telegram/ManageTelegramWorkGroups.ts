import { createHash } from 'node:crypto';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import {
  CannotInviteToDefaultWorkspaceError,
  WorkspaceNotFoundError,
} from '../../domain/workspace/errors.js';
import {
  TelegramBotUnavailableError,
  TelegramGroupNotFoundError,
  TelegramGroupNotMemberError,
  TelegramGroupTakenError,
  TelegramNotLinkedError,
} from '../../domain/telegram/errors.js';
import { requireWorkspaceLead, requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { TelegramClient } from './TelegramClient.js';
import type {
  TelegramGroupLinkPurpose,
  TelegramWorkGroup,
  TelegramWorkGroupRepository,
} from './TelegramWorkGroupRepository.js';

// Код живёт полчаса: человек нажимает кнопку и сразу выбирает группу в Telegram.
const LINK_CODE_TTL_MS = 30 * 60 * 1000;
export const WORK_GROUP_CODE_PREFIX = 'wg_';
// Статусы участника группы, которые считаем «состоит в группе».
const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

type Deps = {
  readonly repo: TelegramWorkGroupRepository;
  readonly workspaces: {
    getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
    getById(id: string): Promise<{ id: string; name: string; kind: WorkspaceKind } | null>;
  };
  readonly users: {
    getTelegramLink(userId: string): Promise<{ telegramUserId: number } | null>;
  };
  readonly telegram: Pick<TelegramClient, 'getChat' | 'getChatMember'>;
  readonly botUsername: string | null;
  // base64url 32 байта (43 символа): влезает в deep link вместе с префиксом.
  readonly randomToken: () => string;
  readonly now: () => Date;
};

export type BindWorkGroupResult =
  | { readonly kind: 'bound' | 'already' | 'main'; readonly workspaceName: string }
  | { readonly kind: 'taken' }
  | { readonly kind: 'invalid' };

export type ResolvedWorkGroup = {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly addedByUserId: string | null;
};

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/**
 * Рабочие Telegram-группы пространства: подключение по коду из deep link (бот сам узнаёт id
 * группы), ручное добавление по id, отключение и разрешение «чья это группа» для бота.
 * См. docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md.
 */
export class ManageTelegramWorkGroups {
  constructor(private readonly deps: Deps) {}

  async list(
    workspaceId: string,
    actorUserId: string,
  ): Promise<{ groups: TelegramWorkGroup[]; botUsername: string | null }> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    return { groups: await this.deps.repo.listByWorkspace(workspaceId), botUsername: this.botUsername() };
  }

  async createLink(
    workspaceId: string,
    actorUserId: string,
    purpose: TelegramGroupLinkPurpose,
  ): Promise<{ url: string; expiresAt: Date }> {
    // Рабочая группа открывает вход в пространство — только владелец/руководитель и только
    // командное пространство. Основную группу сводок меняет любой участник (как карточку сводок).
    if (purpose === 'work') await this.requireTeamLead(workspaceId, actorUserId);
    else await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    const bot = this.botUsername();
    if (!bot) throw new TelegramBotUnavailableError();
    const code = this.deps.randomToken();
    const expiresAt = new Date(this.deps.now().getTime() + LINK_CODE_TTL_MS);
    await this.deps.repo.issueLinkCode({
      tokenHash: hashCode(code),
      workspaceId,
      purpose,
      createdByUserId: actorUserId,
      expiresAt,
    });
    return { url: `https://t.me/${bot}?startgroup=${WORK_GROUP_CODE_PREFIX}${code}`, expiresAt };
  }

  async addManual(workspaceId: string, actorUserId: string, chatId: number): Promise<TelegramWorkGroup> {
    await this.requireTeamLead(workspaceId, actorUserId);
    // У групп и супергрупп Telegram id отрицательный; личный чат группой не бывает.
    if (!Number.isSafeInteger(chatId) || chatId >= 0) throw new TelegramGroupNotFoundError();
    const chat = await this.deps.telegram.getChat?.(chatId).catch(() => null);
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) throw new TelegramGroupNotFoundError();
    const link = await this.deps.users.getTelegramLink(actorUserId);
    if (!link) throw new TelegramNotLinkedError();
    if (!this.deps.telegram.getChatMember) throw new TelegramBotUnavailableError();
    const member = await this.deps.telegram.getChatMember(chatId, link.telegramUserId).catch(() => null);
    if (!member || !MEMBER_STATUSES.has(member.status)) throw new TelegramGroupNotMemberError();
    const group = { chatId, workspaceId, title: chat.title, addedByUserId: actorUserId };
    if ((await this.deps.repo.insert(group)) === 'exists') {
      const existing = await this.deps.repo.findByChat(chatId);
      if (existing?.workspaceId !== workspaceId) throw new TelegramGroupTakenError();
      return existing;
    }
    return (await this.deps.repo.findByChat(chatId)) ?? { ...group, createdAt: this.deps.now() };
  }

  async remove(workspaceId: string, actorUserId: string, chatId: number): Promise<void> {
    await requireWorkspaceLead(this.deps.workspaces, workspaceId, actorUserId);
    await this.deps.repo.remove(workspaceId, chatId);
  }

  // Бот получил в группе «/start@bot wg_<code>» — человек нажал «Подключить группу».
  async bindFromCode(
    code: string,
    chat: { readonly id: number; readonly title: string | null },
  ): Promise<BindWorkGroupResult> {
    const claimed = await this.deps.repo.consumeLinkCode(hashCode(code), this.deps.now());
    if (!claimed) return { kind: 'invalid' };
    const workspace = await this.deps.workspaces.getById(claimed.workspaceId);
    if (!workspace) return { kind: 'invalid' };
    if (claimed.purpose === 'main') {
      await this.deps.repo.setMainGroup(workspace.id, chat.id, chat.title);
      return { kind: 'main', workspaceName: workspace.name };
    }
    if (workspace.kind !== 'team') return { kind: 'invalid' };
    const inserted = await this.deps.repo.insert({
      chatId: chat.id,
      workspaceId: workspace.id,
      title: chat.title,
      addedByUserId: claimed.createdByUserId,
    });
    if (inserted === 'created') return { kind: 'bound', workspaceName: workspace.name };
    const existing = await this.deps.repo.findByChat(chat.id);
    if (existing?.workspaceId !== workspace.id) return { kind: 'taken' };
    if (chat.title) await this.deps.repo.updateTitle(chat.id, chat.title);
    return { kind: 'already', workspaceName: workspace.name };
  }

  // Чья это рабочая группа — для бота. null — группа не рабочая (обычное поведение).
  async resolveChat(chatId: number): Promise<ResolvedWorkGroup | null> {
    const group = await this.deps.repo.findByChat(chatId);
    if (!group) return null;
    const workspace = await this.deps.workspaces.getById(group.workspaceId);
    if (!workspace || workspace.kind !== 'team') return null;
    return { workspaceId: workspace.id, workspaceName: workspace.name, addedByUserId: group.addedByUserId };
  }

  migrateChat(fromChatId: number, toChatId: number): Promise<void> {
    return this.deps.repo.migrateChat(fromChatId, toChatId);
  }

  private botUsername(): string | null {
    const bot = this.deps.botUsername?.replace(/^@/, '').trim();
    return bot && /^[A-Za-z0-9_]+$/.test(bot) ? bot : null;
  }

  private async requireTeamLead(workspaceId: string, actorUserId: string): Promise<void> {
    await requireWorkspaceLead(this.deps.workspaces, workspaceId, actorUserId);
    const workspace = await this.deps.workspaces.getById(workspaceId);
    if (!workspace) throw new WorkspaceNotFoundError();
    if (workspace.kind !== 'team') throw new CannotInviteToDefaultWorkspaceError();
  }
}
