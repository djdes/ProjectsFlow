import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { WorkspaceInviteExpiredError, WorkspaceRejoinBlockedError } from '../../domain/workspace/errors.js';
import type { CreateWorkspaceInviteInput } from '../workspace/WorkspaceInviteRepository.js';
import type { InlineKeyboardMarkup, TelegramClient } from './TelegramClient.js';
import type { GroupOnboarding, TelegramGroupOnboardingRepository } from './TelegramGroupOnboardingRepository.js';

// Сколько ждём подключения человека (столько же живёт персональное приглашение).
const ONBOARDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Полную инструкцию в группе повторяем не чаще, чем раз в 10 минут.
const REPROMPT_AFTER_MS = 10 * 60 * 1000;
// Хватит на несколько сообщений; дальше AI-перефраз всё равно разобьёт текст на задачи.
const MAX_PENDING_TEXT = 4000;
export const ONBOARDING_START_PREFIX = 'wj_';
export const ONBOARDING_CALLBACK_PREFIX = 'wj:';

export type OnboardingPromptInput = {
  readonly chatId: number;
  readonly groupTitle: string | null;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly tgUserId: number;
  readonly senderName: string;
  readonly text: string;
  readonly sourceKey: string | null;
  readonly replyToMessageId: number | null;
  // Аккаунт отправителя, если Telegram привязан (тогда не хватает только членства).
  readonly linkedUserId: string | null;
};

export type StartPendingTaskInput = {
  readonly tgUserId: number;
  readonly chatId: number;
  readonly text: string;
  readonly senderName: string;
  readonly groupTitle: string | null;
  // Ключ идемпотентности конструктора: одна запись подключения — одна задача.
  readonly sourceKey: string;
};

// Что делать с Telegram после принятия приглашения из рабочей группы. Telegram НЕ
// привязывается при принятии: ссылку может открыть кто угодно, а привязать Telegram должен
// сам владелец аккаунта — обычной ссылкой подключения (pair). linked — у аккаунта уже этот
// Telegram; conflict — у аккаунта другой Telegram.
export type InviteTelegramStep =
  | { readonly status: 'pair'; readonly url: string }
  | { readonly status: 'linked' }
  | { readonly status: 'conflict' }
  | null;

type Deps = {
  readonly repo: TelegramGroupOnboardingRepository;
  readonly users: {
    findUserIdByTelegramUserId(telegramUserId: number): Promise<string | null>;
    getTelegramLink(userId: string): Promise<{ readonly telegramUserId: number } | null>;
  };
  readonly workspaces: {
    getById(id: string): Promise<{ id: string; name: string; kind: WorkspaceKind; ownerUserId: string } | null>;
    getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
    addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
    // Удалял ли руководитель этого человека (db/181). Без метода — не удалял.
    wasRemoved?(workspaceId: string, userId: string): Promise<boolean>;
  };
  readonly invites: {
    create(input: CreateWorkspaceInviteInput): Promise<WorkspaceInvite>;
    getById(inviteId: string): Promise<WorkspaceInvite | null>;
    delete(inviteId: string): Promise<boolean>;
  };
  // Чья сейчас группа: подключение действует, пока группа рабочая у того же пространства.
  readonly workGroups: { resolveChat(chatId: number): Promise<{ readonly workspaceId: string } | null> };
  // Обычная ссылка подключения Telegram (t.me/<bot>?start=connect_…) для владельца аккаунта.
  readonly pairing: { start(userId: string): Promise<{ readonly url: string }> };
  readonly client: Pick<TelegramClient, 'sendMessage' | 'answerCallbackQuery'>;
  readonly appUrl: string;
  readonly botUsername: string | null;
  // 12 символов base64url — id записи в deep link.
  readonly shortIdGen: () => string;
  readonly idGen: () => string;
  readonly randomToken: () => string;
  readonly now: () => Date;
  // Обычный конструктор задач (перефраз, карточка) для текста, ждавшего подключения.
  readonly startTask: (input: StartPendingTaskInput) => Promise<void>;
};

/**
 * Подключение человека, который написал задачу в рабочей Telegram-группе, но ещё не может её
 * поставить: нет аккаунта/привязки Telegram или он не участник пространства группы.
 * Группа получает короткую инструкцию с кнопкой; личка бота выдаёт персональное приглашение;
 * после вступления и привязки Telegram бот сам создаёт задачу из запомненного текста.
 * См. docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md.
 */
export class TelegramGroupOnboarding {
  constructor(private readonly deps: Deps) {}

  async prompt(input: OnboardingPromptInput): Promise<void> {
    const now = this.deps.now();
    const text = input.text.trim();
    let row = await this.deps.repo.findOpen(input.chatId, input.tgUserId, now);
    // Telegram повторил доставку того же сообщения — уже обработано.
    if (row && input.sourceKey && row.lastSourceKey === input.sourceKey) return;
    const expiresAt = new Date(now.getTime() + ONBOARDING_TTL_MS);
    if (!row) {
      row = {
        id: this.deps.shortIdGen(),
        tgChatId: input.chatId,
        workspaceId: input.workspaceId,
        tgUserId: input.tgUserId,
        tgUsername: null,
        tgFirstName: null,
        senderName: input.senderName.slice(0, 255),
        groupTitle: input.groupTitle?.slice(0, 255) ?? null,
        pendingText: text ? text.slice(0, MAX_PENDING_TEXT) : null,
        lastSourceKey: input.sourceKey,
        status: 'pending',
        inviteId: null,
        promptedAt: null,
        expiresAt,
      };
      await this.deps.repo.create(row);
    } else {
      const pendingText = [row.pendingText, text].filter((part) => part && part.length > 0).join('\n\n');
      // Группу перенесли в другое пространство — прежнее приглашение было в чужое.
      const movedWorkspace = row.workspaceId !== input.workspaceId;
      if (movedWorkspace && row.inviteId) await this.revokeInvite(row.inviteId);
      const patch = {
        workspaceId: input.workspaceId,
        senderName: input.senderName.slice(0, 255),
        groupTitle: input.groupTitle?.slice(0, 255) ?? null,
        pendingText: pendingText ? pendingText.slice(0, MAX_PENDING_TEXT) : null,
        lastSourceKey: input.sourceKey,
        expiresAt,
        ...(movedWorkspace ? { inviteId: null, status: 'pending' as const, promptedAt: null } : {}),
      };
      await this.deps.repo.update(row.id, patch);
      row = { ...row, ...patch };
    }

    const recentlyPrompted =
      row.promptedAt !== null && now.getTime() - row.promptedAt.getTime() < REPROMPT_AFTER_MS;
    if (recentlyPrompted) {
      await this.send(
        input.chatId,
        '📝 Запомнил — создам задачу, как только подключитесь (кнопка выше).',
        undefined,
        input.replyToMessageId,
      );
      return;
    }
    const name = escapeHtml(input.senderName);
    const space = escapeHtml(input.workspaceName);
    if (input.linkedUserId) {
      await this.send(
        input.chatId,
        `👋 <b>${name}</b>, вы ещё не в пространстве «${space}» — задачу пока не создал.\n` +
          'Нажмите «Вступить» — сразу добавлю вас и создам задачу.',
        { inline_keyboard: [[{ text: `✅ Вступить в «${input.workspaceName}»`.slice(0, 64), callback_data: `${ONBOARDING_CALLBACK_PREFIX}${row.id}` }]] },
        input.replyToMessageId,
      );
    } else {
      const bot = this.botUsername();
      const steps =
        `👋 <b>${name}</b>, вы ещё не подключены к ProjectsFlow — задачу пока не создал.\n\n` +
        '1️⃣ Нажмите «Подключиться» и Start в чате со мной\n' +
        `2️⃣ Зарегистрируйтесь или войдите по ссылке и примите приглашение в «${space}»\n` +
        '3️⃣ Подключите Telegram одной кнопкой на сайте — задачу я создам сам';
      await this.send(
        input.chatId,
        steps,
        bot
          ? { inline_keyboard: [[{ text: '🚀 Подключиться', url: `https://t.me/${bot}?start=${ONBOARDING_START_PREFIX}${row.id}` }]] }
          : undefined,
        input.replyToMessageId,
      );
    }
    await this.deps.repo.update(row.id, { promptedAt: now });
  }

  // Личка: «/start wj_<id>» — человек нажал «Подключиться» под инструкцией в группе.
  async handlePrivateStart(input: {
    readonly id: string;
    readonly chatId: number;
    readonly from: { readonly id: number; readonly username?: string; readonly first_name?: string };
  }): Promise<void> {
    const now = this.deps.now();
    const row = await this.deps.repo.getById(input.id);
    if (!row || (isOpen(row) && row.expiresAt <= now)) {
      await this.send(input.chatId, '⏳ Ссылка устарела. Напишите задачу в группе ещё раз — я пришлю новую кнопку.');
      return;
    }
    // Кнопку видит вся группа, но подключает она только автора сообщения.
    if (row.tgUserId !== input.from.id) {
      await this.send(
        input.chatId,
        'Эта кнопка для другого участника. Напишите задачу в группе сами — я пришлю вашу кнопку.',
      );
      return;
    }
    if (row.status === 'completed') {
      await this.send(input.chatId, '✅ Вы уже подключены — пишите задачи в группе.');
      return;
    }
    const workspace = await this.boundWorkspace(row);
    if (!workspace) {
      await this.send(
        input.chatId,
        '⚠️ Группа больше не подключена к пространству — задачу не создал. Попросите администратора группы подключить её снова.',
      );
      return;
    }
    const userId = await this.deps.users.findUserIdByTelegramUserId(input.from.id);
    if (userId) {
      if (await this.wasRemoved(workspace.id, userId)) {
        await this.send(input.chatId, `⚠️ Вас удалили из пространства «${escapeHtml(workspace.name)}». Попросите руководителя пригласить вас снова.`);
        return;
      }
      await this.ensureMember(workspace.id, userId);
      await this.complete(row, workspace.name, { dmChatId: input.chatId });
      return;
    }

    let invite = row.inviteId ? await this.deps.invites.getById(row.inviteId) : null;
    if (!invite || invite.acceptedAt !== null || invite.expiresAt <= now) {
      const created = await this.deps.invites.create({
        id: this.deps.idGen(),
        workspaceId: workspace.id,
        role: 'editor',
        token: this.deps.randomToken(),
        email: null,
        excludedProjectIds: [],
        expiresAt: new Date(now.getTime() + ONBOARDING_TTL_MS),
        createdByUserId: workspace.ownerUserId,
      });
      if (row.inviteId === null) {
        // Двойной Start: приглашение достаётся первому, лишнее отзываем.
        const stored = await this.deps.repo.setInviteIfAbsent(row.id, created.id);
        if (stored !== created.id) {
          await this.revokeInvite(created.id);
          invite = stored ? await this.deps.invites.getById(stored) : null;
        } else {
          invite = created;
        }
      } else {
        await this.deps.repo.update(row.id, { inviteId: created.id, status: 'invited' });
        invite = created;
      }
    }
    if (!invite) {
      await this.send(input.chatId, '⚠️ Не получилось подготовить приглашение. Нажмите «Подключиться» ещё раз.');
      return;
    }
    await this.deps.repo.update(row.id, {
      tgUsername: input.from.username?.slice(0, 64) ?? row.tgUsername,
      tgFirstName: input.from.first_name?.slice(0, 128) ?? row.tgFirstName,
    });
    const hello = input.from.first_name ? `👋 ${escapeHtml(input.from.first_name)}, осталось` : '👋 Осталось';
    const group = row.groupTitle ? ` в группе «${escapeHtml(row.groupTitle)}»` : ' в группе';
    await this.send(
      input.chatId,
      `${hello} два шага:\n\n` +
        `1️⃣ Откройте ссылку, зарегистрируйтесь (или войдите) и нажмите «Принять» — вы станете участником «${escapeHtml(workspace.name)}»\n` +
        '2️⃣ Там же нажмите «Подключить Telegram» и Start — так Telegram привяжется к вашему аккаунту\n\n' +
        `После этого я сам создам вашу задачу${group}.`,
      { inline_keyboard: [[{ text: '🔑 Регистрация и вход', url: `${this.appUrl()}/invite/${invite.token}` }]] },
    );
  }

  // Группа: кнопка «Вступить» у привязанного человека вне пространства.
  async handleJoinCallback(
    cq: { readonly id: string; readonly from: { readonly id: number } },
    id: string,
  ): Promise<void> {
    const row = await this.deps.repo.getById(id);
    if (!row || (isOpen(row) && row.expiresAt <= this.deps.now())) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Кнопка устарела — напишите задачу ещё раз.', showAlert: true });
      return;
    }
    if (row.tgUserId !== cq.from.id) {
      await this.deps.client.answerCallbackQuery(cq.id, {
        text: `Эта кнопка для ${row.senderName}. Напишите задачу сами — я пришлю вашу.`.slice(0, 190),
        showAlert: true,
      });
      return;
    }
    if (row.status === 'completed') {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Вы уже в пространстве.' });
      return;
    }
    const workspace = await this.boundWorkspace(row);
    if (!workspace) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Группа больше не подключена к пространству.', showAlert: true });
      return;
    }
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Не получилось — напишите задачу ещё раз.', showAlert: true });
      return;
    }
    if (await this.wasRemoved(workspace.id, userId)) {
      await this.deps.client.answerCallbackQuery(cq.id, {
        text: 'Вас удалили из этого пространства. Попросите руководителя пригласить вас снова.',
        showAlert: true,
      });
      return;
    }
    await this.ensureMember(workspace.id, userId);
    await this.deps.client.answerCallbackQuery(cq.id, { text: `✅ Вы в «${workspace.name}»`.slice(0, 190) });
    await this.complete(row, workspace.name, { dmChatId: null });
  }

  // До вступления по приглашению бота: группа ещё рабочая у этого пространства, а человека
  // не удалял руководитель. Обычные приглашения (не из группы) не трогаем.
  async guardInviteAcceptance(input: { readonly inviteId: string; readonly userId: string }): Promise<void> {
    const row = await this.deps.repo.findByInvite(input.inviteId);
    if (!row) return;
    if (!(await this.boundWorkspace(row))) throw new WorkspaceInviteExpiredError();
    if (await this.wasRemoved(row.workspaceId, input.userId)) throw new WorkspaceRejoinBlockedError();
  }

  // Сайт: человек принял приглашение бота. Telegram здесь НЕ привязываем — только подсказываем
  // следующий шаг: обычную ссылку подключения Telegram для владельца аккаунта.
  async completeFromInvite(input: {
    readonly inviteId: string;
    readonly userId: string;
  }): Promise<{ telegram: InviteTelegramStep }> {
    const row = await this.deps.repo.findByInvite(input.inviteId);
    if (!row || !isOpen(row)) return { telegram: null };
    const link = await this.deps.users.getTelegramLink(input.userId);
    if (link) {
      if (link.telegramUserId !== row.tgUserId) return { telegram: { status: 'conflict' } };
      // У аккаунта уже тот же Telegram, что писал в группе (привязан им самим раньше).
      void this.completeForUser(row, input.userId).catch((err) => {
        console.warn('[tg-onboarding] completion failed:', err);
      });
      return { telegram: { status: 'linked' } };
    }
    try {
      const { url } = await this.deps.pairing.start(input.userId);
      return { telegram: { status: 'pair', url } };
    } catch (err) {
      console.warn('[tg-onboarding] pairing link failed:', err);
      return { telegram: null };
    }
  }

  // Telegram только что привязан обычной ссылкой (личка, from.id подтверждён Telegram):
  // создаём задачи, ждавшие этого человека, в пространствах, куда он уже вступил.
  async completeAfterPairing(tgUserId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) return;
    const rows = await this.deps.repo.listOpenForTelegramUser(tgUserId, this.deps.now());
    for (const row of rows) {
      try {
        await this.completeForUser(row, userId);
      } catch (err) {
        console.warn('[tg-onboarding] completion after pairing failed:', err);
      }
    }
  }

  // Группу отключили: закрыть ждущие подключения и отозвать их непринятые приглашения.
  async cancelForGroup(workspaceId: string, chatId: number): Promise<void> {
    const inviteIds = await this.deps.repo.cancelOpenForGroup(workspaceId, chatId);
    for (const inviteId of inviteIds) await this.revokeInvite(inviteId);
  }

  private async completeForUser(row: GroupOnboarding, userId: string): Promise<void> {
    const workspace = await this.boundWorkspace(row);
    if (!workspace) return;
    // Задачу ставим только участнику (вступил по приглашению или раньше).
    if (!(await this.deps.workspaces.getMembership(workspace.id, userId))) return;
    await this.complete(row, workspace.name, { dmChatId: row.tgUserId });
  }

  private async complete(
    row: GroupOnboarding,
    workspaceName: string,
    opts: { readonly dmChatId: number | null },
  ): Promise<void> {
    // Двойное нажатие/повторное принятие: задачу создаёт только первый.
    if (!(await this.deps.repo.claimCompletion(row.id))) return;
    const space = escapeHtml(workspaceName);
    if (opts.dmChatId !== null) {
      const group = row.groupTitle ? ` в группе «${escapeHtml(row.groupTitle)}»` : '';
      await this.send(
        opts.dmChatId,
        row.pendingText
          ? `✅ Готово! Вы в пространстве «${space}». Создаю вашу задачу${group}.`
          : `✅ Готово! Вы в пространстве «${space}». Пишите задачи в группе: упомяните меня и добавьте текст.`,
      );
    }
    await this.send(row.tgChatId, `✅ <b>${escapeHtml(row.senderName)}</b> подключился к пространству «${space}».`);
    if (row.pendingText) {
      try {
        await this.deps.startTask({
          tgUserId: row.tgUserId,
          chatId: row.tgChatId,
          text: row.pendingText,
          senderName: row.senderName,
          groupTitle: row.groupTitle,
          sourceKey: `ob:${row.id}`,
        });
      } catch (err) {
        console.warn('[tg-onboarding] pending task failed:', err);
      }
    }
  }

  // Пространство записи, если группа всё ещё рабочая именно у него; иначе запись закрываем.
  private async boundWorkspace(
    row: GroupOnboarding,
  ): Promise<{ id: string; name: string; ownerUserId: string } | null> {
    if (row.status === 'cancelled') return null;
    const bound = await this.deps.workGroups.resolveChat(row.tgChatId);
    const workspace = bound?.workspaceId === row.workspaceId ? await this.deps.workspaces.getById(row.workspaceId) : null;
    if (!workspace) {
      if (isOpen(row)) await this.deps.repo.update(row.id, { status: 'cancelled' });
      return null;
    }
    return workspace;
  }

  private async wasRemoved(workspaceId: string, userId: string): Promise<boolean> {
    if (await this.deps.workspaces.getMembership(workspaceId, userId)) return false;
    return (await this.deps.workspaces.wasRemoved?.(workspaceId, userId)) ?? false;
  }

  private async revokeInvite(inviteId: string): Promise<void> {
    try {
      const invite = await this.deps.invites.getById(inviteId);
      if (invite && invite.acceptedAt === null) await this.deps.invites.delete(inviteId);
    } catch (err) {
      console.warn('[tg-onboarding] invite revoke failed:', err);
    }
  }

  private async ensureMember(workspaceId: string, userId: string): Promise<void> {
    if (await this.deps.workspaces.getMembership(workspaceId, userId)) return;
    await this.deps.workspaces.addMember(workspaceId, userId, 'editor');
  }

  private async send(
    chatId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
    replyToMessageId?: number | null,
  ): Promise<void> {
    try {
      await this.deps.client.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
        ...(replyMarkup ? { replyMarkup } : {}),
        ...(replyToMessageId && replyToMessageId > 0 ? { replyToMessageId } : {}),
      });
    } catch (err) {
      console.warn('[tg-onboarding] send failed:', err);
    }
  }

  private appUrl(): string {
    return this.deps.appUrl.replace(/\/$/, '');
  }

  private botUsername(): string | null {
    const bot = this.deps.botUsername?.replace(/^@/, '').trim();
    return bot && /^[A-Za-z0-9_]+$/.test(bot) ? bot : null;
  }
}

function isOpen(row: GroupOnboarding): boolean {
  return row.status === 'pending' || row.status === 'invited';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
