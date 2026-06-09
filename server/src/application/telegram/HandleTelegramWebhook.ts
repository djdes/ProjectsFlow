import type { TelegramClient, InlineKeyboardMarkup } from './TelegramClient.js';
import type { TelegramRalphQuestionRepository } from './TelegramRalphQuestionRepository.js';
import type { TelegramTaskMessageRepository } from './TelegramTaskMessageRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { CreateTaskComment } from '../task/CreateTaskComment.js';
import type { MaybeReopenForClarification } from '../task/MaybeReopenForClarification.js';
import type { DispatchCommentNotifications } from '../notifications/DispatchCommentNotifications.js';
import type {
  TelegramComposerService,
  TelegramCallbackQuery,
} from './composer/TelegramComposerService.js';
import {
  getAllTgPrefsResolved,
  type TelegramNotificationPrefs,
} from '../../domain/telegram/TelegramNotificationPrefs.js';

// Минимальный набор полей TG Update, которые мы реально обрабатываем (allowed_updates
// = message + callback_query + inline_query). Структура совпадает с Telegram Bot API:
// https://core.telegram.org/bots/api#update
export type TelegramUpdate = {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly from?: { readonly id: number; readonly username?: string; readonly first_name?: string };
    readonly chat: { readonly id: number; readonly type: string };
    readonly text?: string;
    // Reply на наше сообщение → ловим как ralph-answer ИЛИ комментарий к задаче. См. spec
    // C:/www/ralph/prompts/telegram-reply-to-ralph-answer.md.
    readonly reply_to_message?: {
      readonly message_id: number;
      readonly from?: { readonly id: number; readonly is_bot?: boolean };
    };
  };
  // Нажатие inline-кнопки (конструктор задач, Принять/Отказать, /tasks-навигация).
  readonly callback_query?: TelegramCallbackQuery;
  // Inline-режим (Phase D): `@ProjectsFlow_Bot ...` в поле ввода.
  readonly inline_query?: {
    readonly id: string;
    readonly from: { readonly id: number };
    readonly query: string;
  };
};

type Deps = {
  readonly users: UserRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly client: TelegramClient;
  readonly appUrl: string;
  readonly botUsername: string | null;
  // Reply→ralph-answer ветка. См. spec telegram-reply-to-ralph-answer.md.
  readonly ralphQuestionMessages: TelegramRalphQuestionRepository;
  // Reply→обычный комментарий: маппинг task-сообщений бота → задача (db/049).
  readonly taskMessages: TelegramTaskMessageRepository;
  readonly createComment: CreateTaskComment;
  // Рассылка email+TG участникам по комментарию (как HTTP-роут). Best-effort.
  readonly dispatchCommentNotifications: DispatchCommentNotifications;
  // Конструктор задач (+проект текст @делегат) + обработка кнопок конструктора/делегирования.
  readonly composer: TelegramComposerService;
  readonly maybeReopenForClarification: MaybeReopenForClarification;
  // Live-обновление UI после auto-create комментария / auto-return статуса.
  // Best-effort — webhook не блокирует ответ на SSE.
  readonly notifyTaskChanged: (projectId: string) => void;
  readonly notifyCommentAdded: (
    projectId: string,
    taskId: string,
    commentId: string,
    ownerUserId: string,
    actorKind?: 'user' | 'agent' | 'system',
    agentName?: string | null,
  ) => void;
  readonly notifyStatusChanged: (
    projectId: string,
    taskId: string,
    oldStatus: string,
    newStatus: string,
    actorUserId: string,
  ) => void;
};

// Роутер команд бота. Сами reply'и шлём через TelegramClient.sendMessage — best-effort,
// если отвалится — следующий /start попробует снова.
export class HandleTelegramWebhook {
  constructor(private readonly deps: Deps) {}

  async execute(update: TelegramUpdate): Promise<void> {
    // Нажатие inline-кнопки. `bt:` — навигация /tasks (наш handler); остальное (tp/td/tc/
    // tx/da/dd) — конструктор задач/делегирование.
    if (update.callback_query) {
      const cq = update.callback_query;
      if ((cq.data ?? '').startsWith('bt:')) return this.handleBrowseCallback(cq);
      return this.deps.composer.handleCallback(cq);
    }
    // Inline-режим (Phase D).
    if (update.inline_query) {
      return this.handleInlineQuery(
        update.inline_query.id,
        update.inline_query.from.id,
        update.inline_query.query,
      );
    }

    const msg = update.message;
    if (!msg || !msg.from || !msg.text) return;

    let text = msg.text.trim();
    const tgUserId = msg.from.id;
    const chatId = msg.chat.id;

    // В групповых чатах бот реагирует ТОЛЬКО когда к нему обращаются: упоминание
    // @<botUsername> в тексте ИЛИ reply на сообщение самого бота. Иначе молчим — иначе он
    // отвечал бы на каждое сообщение группы. Личка (private) — без ограничений.
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      const bu = this.deps.botUsername;
      const repliedToBot = msg.reply_to_message?.from?.is_bot === true;
      const mentioned = bu ? new RegExp('@' + bu + '\\b', 'i').test(text) : false;
      if (!repliedToBot && !mentioned) return;
      // Вырезаем @упоминание из текста: чтобы оно не попало в текст задачи и чтобы команды
      // вида «/help@BotName» (так TG шлёт команды в группах) распознавались как «/help».
      if (bu) text = text.replace(new RegExp('@' + bu, 'ig'), '').replace(/\s+/g, ' ').trim();
    }

    // Reply→ralph-answer / комментарий ловим ДО командного роутинга — юзер может reply'нуть
    // просто текстом, без слэш-префикса (типичный TG UX).
    if (msg.reply_to_message?.message_id) {
      return this.handleReply(tgUserId, chatId, msg.reply_to_message.message_id, text);
    }

    // Routing по первому слову.
    const cmd = text.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    if (cmd === '/start') return this.handleStart(tgUserId, chatId, msg.from.first_name);
    if (cmd === '/pause') return this.handlePause(tgUserId, chatId);
    if (cmd === '/pending') return this.handlePending(tgUserId, chatId);
    if (cmd === '/tasks') return this.handleTasks(tgUserId, chatId);
    if (cmd === '/help') return this.handleHelp(chatId);
    // Неизвестная slash-команда — не превращаем в задачу.
    if (cmd.startsWith('/')) return this.handleHelp(chatId);
    // Любой прочий текст → черновик задачи (фаза «любой текст = задача»). Без `+проекта`
    // уходит во «Входящие»; с `+проект`/`@делегат` — конструктор уточнит кнопками.
    return this.deps.composer.startFromMessage(tgUserId, chatId, text);
  }

  // Reply на наше сообщение → ralph-answer комментарий в задаче. Шаги:
  //   1. Найти маппинг (chat, message) → (task, question, recipient).
  //   2. Проверить что отправитель == адресат (нельзя отвечать за другого).
  //   3. Создать коммент с маркером <!-- ralph-answer {...} --> от лица юзера.
  //   4. Триггернуть MaybeReopenForClarification (auto-return awaiting → in_progress).
  //   5. SSE comment_added + (если был возврат) task_status_changed.
  //   6. TG-подтверждение юзеру.
  // На любой неуспех — отвечаем понятным текстом, не падаем (TG retry'ит 5xx лавиной).
  private async handleReply(
    tgUserId: number,
    chatId: number,
    replyToMessageId: number,
    text: string,
  ): Promise<void> {
    const mapping = await this.deps.ralphQuestionMessages.findByMessage(chatId, replyToMessageId);
    if (!mapping) {
      // Не ralph-question → пробуем как обычный комментарий к задаче (reply на карточку
      // конструктора / делегирования / /tasks). См. handleTaskReplyComment.
      return this.handleTaskReplyComment(tgUserId, chatId, replyToMessageId, text);
    }

    const senderUserId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!senderUserId || senderUserId !== mapping.recipientUserId) {
      // Защита от того что чужой TG-аккаунт отвечает на чужое уточнение (после share
      // chat'а, например). По spec'е — отвечает только адресат.
      await this.reply(chatId, '🚫 Ответить на это уточнение может только адресат.');
      return;
    }

    // Грузим задачу — нужен projectId для CreateTaskComment.
    const task = await this.deps.tasks.getById(mapping.taskId);
    if (!task) {
      await this.reply(chatId, '⚠️ Задача удалена. Уточнение больше неактуально.');
      return;
    }

    // Body коммента: видимая шапка + markdown с ответом + machine-readable маркер.
    // Маркер парсится Ralph-диспетчером через Scan-PfAnswers и сервером через
    // MaybeReopenForClarification (substring '<!-- ralph-answer '). Поэтому формат и
    // пробелы важны.
    const answerPayload = {
      v: 1,
      q: mapping.ralphQuestionId,
      value: text,
      source: 'tg-reply-projectsflow-bot',
      answeredAt: new Date().toISOString(),
    };
    const body =
      `**✅ Ответ на уточнение** (через Telegram reply)\n\n${text}\n\n` +
      `<!-- ralph-answer ${JSON.stringify(answerPayload)} -->`;

    let comment;
    try {
      comment = await this.deps.createComment.execute({
        projectId: task.projectId,
        ownerUserId: senderUserId,
        taskId: task.id,
        body,
        // ВАЖНО: это ответ ЧЕЛОВЕКА. Без явного 'user' default бы тоже сработал, но
        // фиксируем явно — чтобы случайно не отрисовать Claude-стиль на этом комменте.
        actorKind: 'user',
      });
    } catch (err) {
      console.warn('[tg-webhook] createComment failed for reply:', err);
      await this.reply(
        chatId,
        '❌ Не удалось сохранить ответ (внутренняя ошибка). Попробуйте через интерфейс ProjectsFlow.',
      );
      return;
    }

    // SSE: новый коммент видят все участники проекта мгновенно.
    this.deps.notifyCommentAdded(
      task.projectId,
      task.id,
      comment.id,
      senderUserId,
      'user',
      null,
    );

    // Auto-return awaiting_clarification → in_progress. Best-effort.
    try {
      const reopened = await this.deps.maybeReopenForClarification.execute(task.id, body);
      if (reopened) {
        this.deps.notifyStatusChanged(
          task.projectId,
          task.id,
          reopened.oldStatus,
          reopened.newStatus,
          senderUserId,
        );
      }
    } catch (err) {
      console.warn('[tg-webhook] auto-reopen failed:', err);
    }
    this.deps.notifyTaskChanged(task.projectId);

    // Подтверждение юзеру. Урезаем текст до 80 символов чтоб не повторять простыню.
    const preview = text.length > 80 ? text.slice(0, 79).trimEnd() + '…' : text;
    await this.reply(
      chatId,
      `✅ Принято: <i>${escapeHtml(preview)}</i>\n\nЗадача возвращена в работу.`,
    );
  }

  private async handleStart(
    tgUserId: number,
    chatId: number,
    firstName: string | undefined,
  ): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      const profileUrl = `${this.deps.appUrl.replace(/\/$/, '')}/profile`;
      await this.reply(
        chatId,
        `👋 Привет! Чтобы получать уведомления, сначала зайди на <a href="${profileUrl}">${profileUrl}</a> и привяжи Telegram через кнопку «Login with Telegram».`,
      );
      return;
    }
    await this.deps.users.markTelegramStarted(userId, chatId);
    const name = firstName ? `, ${firstName}` : '';
    await this.reply(
      chatId,
      `✅ Готово${name}! Бот подключён ко всему твоему аккаунту — доступны все проекты.\n\n` +
        `📝 Чтобы создать задачу, просто напиши мне текст — она уйдёт во «Входящие». ` +
        `Для конкретного проекта: <code>+Проект текст</code>.\n\n` +
        `Все возможности — /help`,
    );
  }

  private async handlePause(tgUserId: number, chatId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    const allOff: TelegramNotificationPrefs = {
      commentOnMyTask: false,
      mention: false,
      statusChange: false,
      ralphQuestion: false,
      ralphAnswer: false,
      taskDone: false,
    };
    await this.deps.users.updateTelegramPrefs(userId, allOff);
    const profileUrl = `${this.deps.appUrl.replace(/\/$/, '')}/profile`;
    await this.reply(
      chatId,
      `⏸️ Уведомления приостановлены. Включить отдельные типы — на <a href="${profileUrl}">${profileUrl}</a>.`,
    );
  }

  private async handlePending(tgUserId: number, chatId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    const projects = await this.deps.members.listProjectsForUser(userId);
    const pending: {
      projectId: string;
      projectName: string;
      taskId: string;
      description: string | null;
    }[] = [];
    for (const p of projects) {
      const list = await this.deps.tasks.listByProject(p.id);
      for (const t of list) {
        if (t.status === 'awaiting_clarification') {
          pending.push({
            projectId: p.id,
            projectName: p.name,
            taskId: t.id,
            description: t.description,
          });
        }
      }
    }
    if (pending.length === 0) {
      await this.reply(chatId, '✨ Нет открытых уточнений.');
      return;
    }
    const base = this.deps.appUrl.replace(/\/$/, '');
    const lines = pending
      .slice(0, 20)
      .map((p) => {
        // ?task= deep-link открывает диалог задачи на board (см. KanbanBoard).
        const url = `${base}/projects/${p.projectId}?task=${p.taskId}`;
        const excerpt = (p.description ?? '').slice(0, 80) || '(без описания)';
        return `• <b>${escapeHtml(p.projectName)}</b>: <a href="${url}">${escapeHtml(excerpt)}</a>`;
      })
      .join('\n');
    await this.reply(
      chatId,
      `🤔 <b>Открытые уточнения (${pending.length}):</b>\n\n${lines}`,
    );
  }

  private async handleHelp(chatId: number): Promise<void> {
    const bot = this.deps.botUsername ? `@${this.deps.botUsername}` : '@бот';
    await this.reply(
      chatId,
      `🤖 <b>ProjectsFlow-бот</b>\n\n` +
        `<b>Создавай задачи прямо отсюда — заходить в проекты не нужно:</b>\n\n` +
        `📥 <b>Во «Входящие»</b> — просто напиши текст:\n` +
        `   <code>Купить домен для лендинга</code>\n\n` +
        `📁 <b>В конкретный проект</b> — добавь <code>+Проект</code> в начало:\n` +
        `   <code>+ScanFlow поправить парсинг чеков</code>\n` +
        `   <i>имя подскажу кнопками, если совпадёт несколько</i>\n\n` +
        `👤 <b>Делегировать коллеге</b> — добавь <code>@Имя</code> в конец:\n` +
        `   <code>+DocsFlow обновить шаблон @Олег</code>\n` +
        `   <i>коллега получит кнопки «Принять / Отказать»</i>\n\n` +
        `⚡ <b>Из любого чата</b> — набери <code>${bot} текст задачи</code> и выбери проект из списка.\n\n` +
        `💬 <b>Комментарий</b> — ответь (reply) на карточку задачи от бота. Участники получат уведомление.\n\n` +
        `<b>Команды:</b>\n` +
        `/tasks — мои проекты и задачи\n` +
        `/pending — задачи «На уточнении»\n` +
        `/pause — выключить уведомления\n` +
        `/start — переподключить бота\n` +
        `/help — эта справка\n\n` +
        `🔗 <i>Telegram привязан ко всему аккаунту сразу — доступны все твои проекты.</i>`,
    );
  }

  // --- Reply на task-сообщение бота → обычный комментарий к задаче (db/049). ---
  private async handleTaskReplyComment(
    tgUserId: number,
    chatId: number,
    replyToMessageId: number,
    text: string,
  ): Promise<void> {
    const map = await this.deps.taskMessages.findByMessage(chatId, replyToMessageId);
    if (!map) {
      await this.reply(
        chatId,
        '↩️ Это сообщение не привязано к задаче. Reply работает на карточки задач, делегирование и уточнения бота.',
      );
      return;
    }
    const senderUserId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!senderUserId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    if (text.trim().length === 0) {
      await this.reply(chatId, '✍️ Пустой комментарий.');
      return;
    }

    let comment;
    try {
      comment = await this.deps.createComment.execute({
        projectId: map.projectId,
        ownerUserId: senderUserId,
        taskId: map.taskId,
        body: text,
        actorKind: 'user',
        notifyMode: 'all',
      });
    } catch (err) {
      const name = err instanceof Error ? err.constructor.name : '';
      if (name === 'ProjectNotFoundError') {
        await this.reply(chatId, '🚫 Нет доступа к этой задаче.');
      } else if (name === 'TaskNotFoundError') {
        await this.reply(chatId, '⚠️ Задача удалена.');
      } else if (name === 'TaskCommentBodyEmptyError') {
        await this.reply(chatId, '✍️ Пустой комментарий.');
      } else {
        console.warn('[tg-webhook] createComment (reply) failed:', err);
        await this.reply(chatId, '❌ Не удалось сохранить комментарий.');
      }
      return;
    }

    // SSE: коммент мгновенно у всех участников.
    this.deps.notifyCommentAdded(map.projectId, map.taskId, comment.id, senderUserId, 'user', null);
    // Email + Telegram участникам — как HTTP-роут (tasks/routes.ts). Best-effort.
    void this.deps.dispatchCommentNotifications
      .execute({
        projectId: map.projectId,
        actorUserId: senderUserId,
        source: 'team',
        audience: { mode: 'all' },
        comment: {
          id: comment.id,
          taskId: map.taskId,
          body: text,
          actorKind: 'user',
          agentName: null,
        },
      })
      .catch((e: unknown) => console.warn('[tg-webhook] dispatchCommentNotifications failed:', e));

    await this.reply(chatId, '💬 Комментарий добавлен.');
  }

  // --- /tasks: просмотр проектов → задач → карточка с reply-комментированием. ---
  private async handleTasks(tgUserId: number, chatId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    const projects = await this.deps.members.listProjectsForUser(userId);
    if (projects.length === 0) {
      await this.reply(chatId, '📭 У тебя пока нет проектов. Напиши текст — создам задачу во «Входящие».');
      return;
    }
    const shown = projects.slice(0, BROWSE_LIMIT);
    const rows = chunk2(
      shown.map((p) => ({ text: p.name.slice(0, 40), callback_data: `bt:p:${p.id}` })),
    );
    const note =
      projects.length > BROWSE_LIMIT
        ? `\n\n<i>Показаны первые ${BROWSE_LIMIT} из ${projects.length} — остальные в интерфейсе.</i>`
        : '';
    await this.reply(chatId, `📂 <b>Выбери проект:</b>${note}`, { inline_keyboard: rows });
  }

  private async handleBrowseCallback(cq: TelegramCallbackQuery): Promise<void> {
    const data = cq.data ?? '';
    // В личном чате chat.id === from.id. Для «старых» сообщений (>48ч) Telegram НЕ
    // присылает cq.message — берём chat из from.id, иначе кнопки старого /tasks ложно
    // ругались бы «Привяжи Telegram», хотя аккаунт привязан. См.
    // core.telegram.org/bots/api#callbackquery («message ... not available if too old»).
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.deps.client.answerCallbackQuery(cq.id, {
        text: 'Сначала привяжи Telegram: в профиле на сайте нажми «Login with Telegram», затем отправь /start.',
        showAlert: true,
      });
      return;
    }
    // bt:p:<projectId> | bt:t:<taskId>
    const body = data.slice('bt:'.length);
    const kind = body.slice(0, 2);
    const arg = body.slice(2);

    if (kind === 'p:') {
      const projectId = arg;
      const membership = await this.deps.members.findForProject(projectId, userId);
      if (!membership) {
        await this.deps.client.answerCallbackQuery(cq.id, { text: 'Нет доступа к проекту.', showAlert: true });
        return;
      }
      const tasks = (await this.deps.tasks.listByProject(projectId)).filter(
        (t) => t.status !== 'done',
      );
      if (tasks.length === 0) {
        await this.reply(chatId, '✨ В этом проекте нет открытых задач.');
        await this.deps.client.answerCallbackQuery(cq.id);
        return;
      }
      const shown = tasks.slice(0, BROWSE_LIMIT);
      const rows = shown.map((t) => [
        {
          text: excerptShort(t.description, 56),
          callback_data: `bt:t:${t.id}`,
        },
      ]);
      const note =
        tasks.length > BROWSE_LIMIT
          ? `\n\n<i>Показаны первые ${BROWSE_LIMIT} из ${tasks.length}.</i>`
          : '';
      await this.reply(chatId, `📋 <b>Задачи:</b> (нажми, чтобы открыть)${note}`, {
        inline_keyboard: rows,
      });
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }

    if (kind === 't:') {
      const taskId = arg;
      const task = await this.deps.tasks.getById(taskId);
      if (!task) {
        await this.deps.client.answerCallbackQuery(cq.id, { text: 'Задача удалена.', showAlert: true });
        return;
      }
      const membership = await this.deps.members.findForProject(task.projectId, userId);
      if (!membership) {
        await this.deps.client.answerCallbackQuery(cq.id, { text: 'Нет доступа к задаче.', showAlert: true });
        return;
      }
      const base = this.deps.appUrl.replace(/\/$/, '');
      const url = `${base}/projects/${task.projectId}?task=${task.id}`;
      const body2 =
        `📌 <b>Задача</b> (${escapeHtml(task.status)})\n` +
        `${escapeHtml(excerptShort(task.description, 300))}\n\n` +
        `<a href="${url}">Открыть в ProjectsFlow</a>\n\n` +
        `↩️ Ответь reply'ем на это сообщение, чтобы добавить комментарий.`;
      const messageId = await this.sendReturningId(chatId, body2);
      if (messageId !== null) {
        await this.deps.taskMessages.upsert({
          tgChatId: chatId,
          tgMessageId: messageId,
          recipientUserId: userId,
          taskId: task.id,
          projectId: task.projectId,
        });
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }

    await this.deps.client.answerCallbackQuery(cq.id);
  }

  // Inline-режим (Phase D): живой dropdown проектов/делегатов.
  private async handleInlineQuery(
    inlineQueryId: string,
    tgUserId: number,
    query: string,
  ): Promise<void> {
    await this.deps.composer.handleInlineQuery(inlineQueryId, tgUserId, query);
  }

  private async reply(
    chatId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    try {
      await this.deps.client.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
        replyMarkup,
      });
    } catch (err) {
      console.warn('[tg-webhook] reply failed', err);
    }
  }

  // Как reply, но возвращает message_id (для маппинга task-сообщения в /tasks). null при ошибке.
  private async sendReturningId(chatId: number, text: string): Promise<number | null> {
    try {
      const res = await this.deps.client.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
      return res.kind === 'ok' ? res.messageId : null;
    } catch (err) {
      console.warn('[tg-webhook] sendReturningId failed', err);
      return null;
    }
  }
}

// Максимум кнопок проектов/задач в /tasks (без пагинации в v1 — остальное в вебе).
const BROWSE_LIMIT = 12;

// Разбивка списка кнопок по 2 в ряд.
function chunk2<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}

function excerptShort(text: string | null, limit: number): string {
  const s = (text ?? '').trim().replace(/\s+/g, ' ');
  if (s.length === 0) return '(без описания)';
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
