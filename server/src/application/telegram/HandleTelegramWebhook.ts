import type { TelegramClient } from './TelegramClient.js';
import type { TelegramRalphQuestionRepository } from './TelegramRalphQuestionRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { CreateTaskComment } from '../task/CreateTaskComment.js';
import type { MaybeReopenForClarification } from '../task/MaybeReopenForClarification.js';
import {
  getAllTgPrefsResolved,
  type TelegramNotificationPrefs,
} from '../../domain/telegram/TelegramNotificationPrefs.js';

// Минимальный набор полей TG Update, которые мы реально обрабатываем (allowed_updates
// = ['message']). Структура совпадает с Telegram Bot API:
// https://core.telegram.org/bots/api#update
export type TelegramUpdate = {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly from?: { readonly id: number; readonly username?: string; readonly first_name?: string };
    readonly chat: { readonly id: number; readonly type: string };
    readonly text?: string;
    // Reply на наше сообщение → ловим как ralph-answer. См. spec
    // C:/www/ralph/prompts/telegram-reply-to-ralph-answer.md.
    readonly reply_to_message?: {
      readonly message_id: number;
      readonly from?: { readonly id: number; readonly is_bot?: boolean };
    };
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
  readonly createComment: CreateTaskComment;
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
    const msg = update.message;
    if (!msg || !msg.from || !msg.text) return;

    const text = msg.text.trim();
    const tgUserId = msg.from.id;
    const chatId = msg.chat.id;

    // Reply→ralph-answer ловим ДО командного роутинга — юзер может reply'нуть на
    // ralph-question просто текстом, без слэш-префикса (типичный TG UX).
    if (msg.reply_to_message?.message_id) {
      return this.handleReply(tgUserId, chatId, msg.reply_to_message.message_id, text);
    }

    // Routing по первому слову — это командный текст. Игнор остального.
    const cmd = text.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    if (cmd === '/start') return this.handleStart(tgUserId, chatId, msg.from.first_name);
    if (cmd === '/pause') return this.handlePause(tgUserId, chatId);
    if (cmd === '/pending') return this.handlePending(tgUserId, chatId);
    if (cmd === '/help') return this.handleHelp(chatId);
    // Прочие сообщения — игнор. Если юзер хочет ответить — пусть use reply на сообщение бота.
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
      // Reply не на наш ralph-question (например на /start, или старое сообщение, или
      // вопрос которого мы не сохранили). Деликатно объясняем.
      await this.reply(
        chatId,
        '↩️ Это сообщение не привязано к открытому вопросу Ralph. Ответы через reply работают только на свежие уточнения (`🤔 Ralph задал уточнение…`).',
      );
      return;
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
      `✅ Привет${name}! Бот подключён. Теперь буду присылать уведомления по твоим задачам.\n\nКоманды: /pending — открытые уточнения, /pause — остановить уведомления, /help — справка.`,
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
    await this.reply(
      chatId,
      `<b>Команды бота:</b>\n` +
        `/start — подключение (после привязки на /profile)\n` +
        `/pending — список твоих задач в статусе «На уточнении»\n` +
        `/pause — отключить все уведомления\n` +
        `/help — эта справка`,
    );
  }

  private async reply(chatId: number, text: string): Promise<void> {
    try {
      await this.deps.client.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
    } catch (err) {
      console.warn('[tg-webhook] reply failed', err);
    }
  }
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
