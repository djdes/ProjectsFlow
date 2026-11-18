import { createHash } from 'node:crypto';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  CannotInviteToDefaultWorkspaceError,
  WorkspaceNotFoundError,
} from '../../domain/workspace/errors.js';
import {
  TelegramBotUnavailableError,
  TelegramGroupDraftElsewhereError,
  TelegramGroupTransferNotFoundError,
  TelegramGroupTransferRequestedError,
  TelegramGroupNotAdminError,
  TelegramGroupNotFoundError,
  TelegramGroupProjectInvalidError,
  TelegramGroupTakenError,
  TelegramNotLinkedError,
} from '../../domain/telegram/errors.js';
import { requireWorkspaceLead, requireWorkspaceMember, requireWorkspaceOwner } from '../workspace/workspaceAccess.js';
import type { TelegramClient } from './TelegramClient.js';
import type {
  TelegramGroupLinkPurpose,
  TelegramWorkGroup,
  TelegramWorkGroupMode,
  TelegramWorkGroupRepository,
} from './TelegramWorkGroupRepository.js';

// Код живёт полчаса: человек нажимает кнопку и сразу выбирает группу в Telegram.
const LINK_CODE_TTL_MS = 30 * 60 * 1000;
export const WORK_GROUP_CODE_PREFIX = 'wg_';
// Кто вправе подключать группу к пространству: её создатель и администраторы.
const ADMIN_STATUSES = new Set(['creator', 'administrator']);

type Deps = {
  readonly repo: TelegramWorkGroupRepository;
  readonly workspaces: {
    getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
    getById(id: string): Promise<{ id: string; name: string; kind: WorkspaceKind } | null>;
    // Черновик группы (db/189): в каких командных пространствах пригласивший бота руководит.
    listForUser?(userId: string): Promise<
      readonly { id: string; name: string; kind: WorkspaceKind; role: WorkspaceRole }[]
    >;
  };
  readonly users: {
    getTelegramLink(userId: string): Promise<{ telegramUserId: number } | null>;
    findUserIdByTelegramUserId?(telegramUserId: number): Promise<string | null>;
  };
  // Проверка проектов группы (db/189): только проекты пространства группы, не «Входящие».
  readonly projects?: {
    getById(id: string): Promise<{ id: string; workspaceId: string; isInbox: boolean } | null>;
  };
  readonly telegram: Pick<TelegramClient, 'getChat' | 'getChatAdministrators'>;
  readonly botUsername: string | null;
  // base64url 32 байта (43 символа): влезает в deep link вместе с префиксом.
  readonly randomToken: () => string;
  readonly now: () => Date;
  // Группу отключили: закрыть ждущие подключения людей и их приглашения.
  readonly onRemoved?: (workspaceId: string, chatId: number) => Promise<void>;
};

export type BindWorkGroupResult =
  | { readonly kind: 'bound' | 'already' | 'main'; readonly workspaceName: string }
  | { readonly kind: 'taken' }
  // Черновик ждёт подтверждения в другом пространстве / ушёл запрос владельцу прежнего пространства.
  | { readonly kind: 'draft_elsewhere' | 'transfer_requested' }
  | { readonly kind: 'not_admin' }
  | { readonly kind: 'invalid' };

export type ResolvedWorkGroup = {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly addedByUserId: string | null;
  readonly mode: TelegramWorkGroupMode;
};

// Бота добавили в группу (my_chat_member, db/189).
//  active       — группа уже рабочая, ничего не меняем;
//  draft        — создан черновик в пространстве пригласившего, ждёт подтверждения;
//  choose       — пригласивший руководит несколькими пространствами: спросить, в какое;
//  not_linked   — Telegram пригласившего не привязан к PF (черновик не создаём);
//  no_workspace — пригласивший не владелец/руководитель ни одного командного пространства.
export type BotAddedResult =
  | { readonly kind: 'active' }
  | { readonly kind: 'draft'; readonly workspaceName: string }
  | { readonly kind: 'choose'; readonly options: readonly { readonly id: string; readonly name: string }[] }
  | { readonly kind: 'not_linked' }
  | { readonly kind: 'no_workspace' }
  | { readonly kind: 'draft_elsewhere' | 'transfer_requested' };

// Можно ли занять группу пространством (защита от перехвата чужой группы):
//  free               — группы нет или она уже этого пространства;
//  taken              — активна в другом пространстве;
//  draft_elsewhere    — черновик другого пространства (активирует только оно);
//  transfer_requested — отключена в другом пространстве: записан запрос его владельцу.
type ClaimOutcome = 'free' | 'taken' | 'draft_elsewhere' | 'transfer_requested';

const LEAD_ROLES: ReadonlySet<WorkspaceRole> = new Set<WorkspaceRole>(['owner', 'lead']);

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
  ): Promise<{
    groups: Array<TelegramWorkGroup & { readonly transferWorkspaceName?: string | null }>;
    mainGroup: { chatId: number; title: string | null } | null;
    botUsername: string | null;
  }> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    const [raw, mainGroup] = await Promise.all([
      this.deps.repo.listByWorkspace(workspaceId),
      this.deps.repo.getMainGroup(workspaceId),
    ]);
    // Запрос на перенос показываем с именем пространства, куда просят перенести группу.
    const groups = await Promise.all(
      raw.map(async (g) =>
        g.transfer && g.status === 'disconnected'
          ? { ...g, transferWorkspaceName: (await this.deps.workspaces.getById(g.transfer.toWorkspaceId))?.name ?? null }
          : { ...g, transfer: null },
      ),
    );
    return { groups, mainGroup, botUsername: this.botUsername() };
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
    if (!(await this.isGroupAdmin(chatId, link.telegramUserId))) throw new TelegramGroupNotAdminError();
    const group = { chatId, workspaceId, title: chat.title, addedByUserId: actorUserId };
    if ((await this.deps.repo.insert(group)) === 'exists') {
      const existing = await this.deps.repo.findByChat(chatId);
      const claim = await this.claim(existing, workspaceId, actorUserId, 'active');
      if (claim === 'taken') throw new TelegramGroupTakenError();
      if (claim === 'draft_elsewhere') throw new TelegramGroupDraftElsewhereError();
      if (claim === 'transfer_requested') throw new TelegramGroupTransferRequestedError();
      if (!existing) throw new TelegramGroupNotFoundError();
      // Свой черновик или своя отключённая группа: руководитель (он — админ группы) подключает.
      if (existing.status !== 'active') {
        await this.deps.repo.replace({ ...group, status: 'active' });
        return (await this.deps.repo.findByChat(chatId)) ?? existing;
      }
      return existing;
    }
    return (
      (await this.deps.repo.findByChat(chatId)) ?? {
        ...group,
        createdAt: this.deps.now(),
        status: 'active',
        mode: 'standard',
        invitedByTgUserId: null,
        projectIds: [],
      }
    );
  }

  async remove(workspaceId: string, actorUserId: string, chatId: number): Promise<void> {
    await requireWorkspaceLead(this.deps.workspaces, workspaceId, actorUserId);
    if (await this.deps.repo.remove(workspaceId, chatId)) {
      await this.deps.onRemoved?.(workspaceId, chatId);
    }
  }

  // Бот получил в группе «/start@bot wg_<code>» — человек нажал «Подключить группу». Код выдают
  // владелец/руководитель пространства, а отправить его в группу должен её администратор.
  async bindFromCode(
    code: string,
    chat: { readonly id: number; readonly title: string | null },
    senderTelegramUserId: number,
  ): Promise<BindWorkGroupResult> {
    // Проверяем права до того, как погасить код: администратор сможет подключить им же.
    if (!(await this.isGroupAdmin(chat.id, senderTelegramUserId))) return { kind: 'not_admin' };
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
    const claim = await this.claim(existing, workspace.id, claimed.createdByUserId, 'active');
    if (claim !== 'free') return { kind: claim };
    // Свой черновик/отключённая группа: код выдал руководитель, отправил админ группы — подключаем.
    if (existing && existing.status !== 'active') {
      await this.deps.repo.replace({
        chatId: chat.id,
        workspaceId: workspace.id,
        title: chat.title,
        addedByUserId: claimed.createdByUserId,
        status: 'active',
      });
      return { kind: 'bound', workspaceName: workspace.name };
    }
    if (chat.title) await this.deps.repo.updateTitle(chat.id, chat.title);
    return { kind: 'already', workspaceName: workspace.name };
  }

  // Чья это рабочая группа — для бота. null — группа не рабочая (обычное поведение).
  async resolveChat(chatId: number): Promise<ResolvedWorkGroup | null> {
    const group = await this.deps.repo.findByChat(chatId);
    // Черновик ничего не открывает: для бота это обычная, не рабочая группа (spec, раздел 1).
    if (!group || group.status !== 'active') return null;
    const workspace = await this.deps.workspaces.getById(group.workspaceId);
    if (!workspace || workspace.kind !== 'team') return null;
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      addedByUserId: group.addedByUserId,
      mode: group.mode ?? 'standard',
    };
  }

  // Проекты, доступные группе в боте. Пусто — все проекты пространства (spec, раздел 2).
  async allowedProjectIds(chatId: number): Promise<string[]> {
    return this.deps.repo.listActiveProjectIds(chatId);
  }

  // «Подключить» черновик — владелец/руководитель пространства (решение владельца №2).
  async confirm(workspaceId: string, actorUserId: string, chatId: number): Promise<TelegramWorkGroup> {
    await this.requireTeamLead(workspaceId, actorUserId);
    const group = await this.groupOf(workspaceId, chatId);
    if (group.status === 'disconnected') throw new TelegramGroupNotFoundError();
    if (group.status === 'draft') await this.deps.repo.setStatus(chatId, 'active');
    return (await this.deps.repo.findByChat(chatId)) ?? group;
  }

  // Режим группы (spec 2026-11-17, раздел 3): только активная группа, владелец/руководитель.
  async setMode(
    workspaceId: string,
    actorUserId: string,
    chatId: number,
    mode: TelegramWorkGroupMode,
  ): Promise<TelegramWorkGroup> {
    await this.requireTeamLead(workspaceId, actorUserId);
    const group = await this.groupOf(workspaceId, chatId);
    if (group.status !== 'active') throw new TelegramGroupNotFoundError();
    if (group.mode !== mode) await this.deps.repo.setMode(chatId, mode);
    return (await this.deps.repo.findByChat(chatId)) ?? { ...group, mode };
  }

  // Проекты группы целиком: только проекты пространства группы (spec, раздел 2).
  async setProjects(
    workspaceId: string,
    actorUserId: string,
    chatId: number,
    projectIds: readonly string[],
  ): Promise<TelegramWorkGroup> {
    await this.requireTeamLead(workspaceId, actorUserId);
    const group = await this.groupOf(workspaceId, chatId);
    const unique = [...new Set(projectIds)];
    if (unique.length > 0) {
      const projects = this.deps.projects;
      if (!projects) throw new TelegramGroupProjectInvalidError();
      const found = await Promise.all(unique.map((id) => projects.getById(id)));
      if (found.some((p) => !p || p.workspaceId !== workspaceId || p.isInbox)) {
        throw new TelegramGroupProjectInvalidError();
      }
    }
    await this.deps.repo.setProjects(chatId, unique, actorUserId);
    return (await this.deps.repo.findByChat(chatId)) ?? group;
  }

  // Бота добавили в группу (my_chat_member → member/administrator). Не рабочая группа становится
  // черновиком пространства пригласившего (spec, раздел 1).
  async handleBotAdded(
    chat: { readonly id: number; readonly title: string | null },
    inviterTelegramUserId: number,
  ): Promise<BotAddedResult> {
    const existing = await this.deps.repo.findByChat(chat.id);
    if (existing?.status === 'active') {
      if (chat.title) await this.deps.repo.updateTitle(chat.id, chat.title);
      return { kind: 'active' };
    }
    const userId = await this.deps.users.findUserIdByTelegramUserId?.(inviterTelegramUserId);
    if (!userId) return { kind: 'not_linked' };
    const spaces = ((await this.deps.workspaces.listForUser?.(userId)) ?? []).filter(
      (w) => w.kind === 'team' && LEAD_ROLES.has(w.role),
    );
    if (spaces.length === 0) return { kind: 'no_workspace' };
    if (spaces.length > 1) {
      return { kind: 'choose', options: spaces.map((w) => ({ id: w.id, name: w.name })) };
    }
    const space = spaces[0]!;
    const saved = await this.saveDraft(chat, space.id, userId, inviterTelegramUserId);
    if (saved !== 'free') return { kind: saved === 'taken' ? 'active' : saved };
    return { kind: 'draft', workspaceName: space.name };
  }

  // Пригласивший выбрал пространство кнопкой в личке (handleBotAdded → choose).
  async chooseDraftWorkspace(
    chat: { readonly id: number; readonly title: string | null },
    workspaceId: string,
    telegramUserId: number,
  ): Promise<
    | { readonly kind: 'draft'; readonly workspaceName: string }
    | { readonly kind: 'active' | 'forbidden' | 'draft_elsewhere' | 'transfer_requested' }
  > {
    const userId = await this.deps.users.findUserIdByTelegramUserId?.(telegramUserId);
    if (!userId) return { kind: 'forbidden' };
    const member = await this.deps.workspaces.getMembership(workspaceId, userId);
    const workspace = await this.deps.workspaces.getById(workspaceId);
    if (!member || !LEAD_ROLES.has(member.role) || !workspace || workspace.kind !== 'team') {
      return { kind: 'forbidden' };
    }
    const existing = await this.deps.repo.findByChat(chat.id);
    if (existing?.status === 'active') return { kind: 'active' };
    const saved = await this.saveDraft(chat, workspaceId, userId, telegramUserId);
    if (saved !== 'free') return { kind: saved === 'taken' ? 'active' : saved };
    return { kind: 'draft', workspaceName: workspace.name };
  }

  // Бота удалили из группы (my_chat_member → left/kicked): группа отключена, ждущие подключения
  // людей закрываются (как при отключении руководителем).
  async handleBotRemoved(chatId: number): Promise<void> {
    const group = await this.deps.repo.findByChat(chatId);
    if (!group || group.status === 'disconnected') return;
    await this.deps.repo.setStatus(chatId, 'disconnected');
    if (group.status === 'active') await this.deps.onRemoved?.(group.workspaceId, chatId);
  }

  private async saveDraft(
    chat: { readonly id: number; readonly title: string | null },
    workspaceId: string,
    userId: string,
    inviterTelegramUserId: number,
  ): Promise<ClaimOutcome> {
    const existing = await this.deps.repo.findByChat(chat.id);
    const claim = await this.claim(existing, workspaceId, userId, 'draft');
    if (claim !== 'free') return claim;
    const draft = {
      chatId: chat.id,
      workspaceId,
      title: chat.title,
      addedByUserId: userId,
      status: 'draft' as const,
      invitedByTgUserId: inviterTelegramUserId,
    };
    if ((await this.deps.repo.insert(draft)) === 'exists') await this.deps.repo.replace(draft);
    return 'free';
  }

  // Защита от перехвата: чужой черновик не трогаем, чужую активную группу не забираем, чужую
  // отключённую — только через запрос владельцу её пространства (approveTransfer).
  private async claim(
    existing: TelegramWorkGroup | null,
    workspaceId: string,
    requestedByUserId: string,
    targetStatus: 'draft' | 'active',
  ): Promise<ClaimOutcome> {
    if (!existing || existing.workspaceId === workspaceId) return 'free';
    if (existing.status === 'active') return 'taken';
    if (existing.status === 'draft') return 'draft_elsewhere';
    await this.deps.repo.requestTransfer(existing.chatId, { toWorkspaceId: workspaceId, requestedByUserId, targetStatus });
    return 'transfer_requested';
  }

  // Владелец прежнего пространства отключённой группы разрешает перенос в запросившее пространство.
  async approveTransfer(workspaceId: string, actorUserId: string, chatId: number): Promise<void> {
    await requireWorkspaceOwner(this.deps.workspaces, workspaceId, actorUserId);
    const group = await this.groupOf(workspaceId, chatId);
    const transfer = group.transfer;
    if (!transfer || group.status !== 'disconnected') throw new TelegramGroupTransferNotFoundError();
    const target = await this.deps.workspaces.getById(transfer.toWorkspaceId);
    if (!target || target.kind !== 'team') {
      await this.deps.repo.clearTransfer(chatId);
      throw new TelegramGroupTransferNotFoundError();
    }
    await this.deps.repo.replace({
      chatId,
      workspaceId: target.id,
      title: group.title,
      addedByUserId: transfer.requestedByUserId,
      status: transfer.targetStatus,
    });
  }

  // Владелец прежнего пространства отклоняет перенос: группа остаётся у него отключённой.
  async rejectTransfer(workspaceId: string, actorUserId: string, chatId: number): Promise<void> {
    await requireWorkspaceOwner(this.deps.workspaces, workspaceId, actorUserId);
    const group = await this.groupOf(workspaceId, chatId);
    if (!group.transfer) throw new TelegramGroupTransferNotFoundError();
    await this.deps.repo.clearTransfer(chatId);
  }

  private async groupOf(workspaceId: string, chatId: number): Promise<TelegramWorkGroup> {
    const group = await this.deps.repo.findByChat(chatId);
    if (!group || group.workspaceId !== workspaceId) throw new TelegramGroupNotFoundError();
    return group;
  }

  migrateChat(fromChatId: number, toChatId: number): Promise<void> {
    return this.deps.repo.migrateChat(fromChatId, toChatId);
  }

  private async isGroupAdmin(chatId: number, telegramUserId: number): Promise<boolean> {
    const admins = await this.deps.telegram.getChatAdministrators?.(chatId).catch(() => null);
    return (admins ?? []).some((admin) => admin.userId === telegramUserId && ADMIN_STATUSES.has(admin.status));
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
