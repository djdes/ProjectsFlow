import type { Task } from '../../domain/task/Task.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskDelegationRepository } from '../task/TaskDelegationRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  readonly tgSend: SendAgentTelegramNotification;
  readonly appUrl: string;
  // Групповой тимбилдинг-нудж (опц.): клиент + chat_id группы проекта. Если getGroupChatId
  // не задан или вернул null — без группового сообщения.
  readonly telegramClient?: TelegramClient;
  readonly getGroupChatId?: (projectId: string) => Promise<number | null>;
};

const OPEN_STATUSES = new Set<string>(['todo', 'in_progress', 'awaiting_clarification']);
const STATUS_LABEL: Record<string, string> = {
  todo: 'в очереди',
  in_progress: 'в работе',
  awaiting_clarification: 'ждёт уточнения',
};
const MAX_TASKS_IN_MSG = 12;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Заголовок задачи = первая строка описания (в этой системе нет отдельного title).
function taskTitle(t: Task, limit = 70): string {
  const first = (t.description ?? '').split('\n')[0]?.trim() ?? '';
  const s = first.replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

// EOD-напоминание (db/101, Фаза 2): каждому участнику перед уходом — актуализировать свои
// открытые задачи; у кого пусто — предложить помочь другим; в группу — тимбилдинг-нудж.
// Полностью детерминированно (без диспетчера/раннера). Всё best-effort.
export class SendEodReminder {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string): Promise<void> {
    const project = await this.deps.projects.getById(projectId);
    if (!project) return;

    const members = await this.deps.members.listByProject(projectId);
    if (members.length === 0) return;

    const allTasks = await this.deps.tasks.listByProject(projectId);
    const openTasks = allTasks.filter((t) => OPEN_STATUSES.has(t.status));

    // Нет открытых задач → актуализировать нечего. Не шлём вовсе (иначе при «вкл на всех»
    // участник получал бы «всё закрыто» по каждой пустой песочнице — спам). Пустые/мёртвые
    // проекты молчат; напоминания только там, где реально есть незакрытая работа.
    if (openTasks.length === 0) return;

    // Открытые задачи, сгруппированные по делегату (кому поручены).
    const byDelegate = new Map<string, Task[]>();
    if (openTasks.length > 0) {
      const delegationMap = await this.deps.delegations.listActiveForTasks(
        openTasks.map((t) => t.id),
      );
      for (const t of openTasks) {
        const d = delegationMap.get(t.id);
        if (!d) continue;
        const arr = byDelegate.get(d.delegateUserId) ?? [];
        arr.push(t);
        byDelegate.set(d.delegateUserId, arr);
      }
    }

    const boardUrl = `${this.deps.appUrl}/p/${projectId}`;
    for (const m of members) {
      const myTasks = byDelegate.get(m.userId) ?? [];
      const text =
        myTasks.length > 0
          ? this.withTasksMessage(project.name, myTasks, boardUrl)
          : this.noTasksMessage(project.name, boardUrl);
      try {
        await this.deps.tgSend.execute({
          userId: m.userId,
          text,
          parseMode: 'HTML',
          kind: 'eod_reminder',
        });
      } catch (err) {
        console.warn('[SendEodReminder] DM failed', m.userId, err);
      }
    }

    // Групповой нудж (тимбилдинг) — если у проекта задан chat_id группы.
    if (this.deps.getGroupChatId && this.deps.telegramClient) {
      try {
        const chatId = await this.deps.getGroupChatId(projectId);
        if (chatId !== null) {
          await this.deps.telegramClient.sendMessage({
            chatId,
            text:
              `🕔 <b>Перед уходом — актуализируйте задачи.</b>\n` +
              `Не копите делегированное: если что-то не движется — спросите или предложите помощь. ` +
              `Вопросы по задачам — в комментариях в проекте, отвечу и помогу.\n` +
              `Хорошего вечера! 🌇`,
            parseMode: 'HTML',
            disableWebPagePreview: true,
          });
        }
      } catch (err) {
        console.warn('[SendEodReminder] group nudge failed', projectId, err);
      }
    }
  }

  private withTasksMessage(projectName: string, tasks: Task[], boardUrl: string): string {
    const shown = tasks.slice(0, MAX_TASKS_IN_MSG);
    const lines = shown.map(
      (t) => `• <b>${escapeHtml(taskTitle(t))}</b> — <i>${STATUS_LABEL[t.status] ?? t.status}</i>`,
    );
    const more = tasks.length > shown.length ? `\n…и ещё ${tasks.length - shown.length}` : '';
    return (
      `🕔 <b>Перед уходом актуализируй свои задачи</b> в «${escapeHtml(projectName)}»:\n` +
      `${lines.join('\n')}${more}\n\n` +
      `Отметь статус или оставь коммент. Если завис — напиши в задаче, помогут. ` +
      `<a href="${boardUrl}">Открыть доску</a>`
    );
  }

  private noTasksMessage(projectName: string, boardUrl: string): string {
    return (
      `🎉 <b>У тебя всё закрыто</b> в «${escapeHtml(projectName)}».\n` +
      `Загляни на доску или во вкладку «Другим» — может, кому-то нужна помощь. ` +
      `Возьмёшь — согласуй с делегатом. <a href="${boardUrl}">Открыть доску</a>`
    );
  }
}
