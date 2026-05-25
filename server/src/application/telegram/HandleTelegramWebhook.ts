import type { TelegramClient } from './TelegramClient.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
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
  };
};

type Deps = {
  readonly users: UserRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly client: TelegramClient;
  readonly appUrl: string;
  readonly botUsername: string | null;
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

    // Routing по первому слову — это командный текст. Игнор остального.
    const cmd = text.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    if (cmd === '/start') return this.handleStart(tgUserId, chatId, msg.from.first_name);
    if (cmd === '/pause') return this.handlePause(tgUserId, chatId);
    if (cmd === '/pending') return this.handlePending(tgUserId, chatId);
    if (cmd === '/help') return this.handleHelp(chatId);
    // Прочие сообщения — пока игнор. Reply'и → комментарии в задачу — future scope.
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
