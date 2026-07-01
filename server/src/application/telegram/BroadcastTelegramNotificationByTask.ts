import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { SendAgentTelegramNotification } from './SendAgentTelegramNotification.js';

export type BroadcastByTaskCommand = {
  readonly taskId: string;
  readonly text: string;
  readonly kind: string;
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  readonly replyMarkup?: unknown;
  readonly skipDedupCheck?: boolean;
  // По умолчанию true: prefs учитываются (получатель с pref_off → skipped).
  // false — присылать всем привязанным независимо от prefs (high-priority override).
  readonly respectPrefs: boolean;
  // Если задан — исключаем из получателей (caller через @RalphBot и так получит).
  readonly skipUserId?: string;
  // Прокидывается в SendAgentTelegramNotification для каждого получателя — нужен
  // чтобы сохранить маппинг message_id → question_id для последующего reply-handling'а.
  // См. spec telegram-reply-to-ralph-answer.md.
  readonly ralphQuestionId?: string;
};

export type BroadcastResultItem =
  | { readonly userId: string; readonly status: 'ok'; readonly messageId: number }
  | {
      readonly userId: string;
      readonly status: 'skipped';
      readonly reason:
        | 'not_connected'
        | 'not_started'
        | 'pref_off'
        | 'dedup'
        | 'self'
        | 'forbidden'
        | 'rate_limited'
        | 'error';
      readonly detail?: string;
    };

export type BroadcastByTaskResult = {
  readonly sent: number;
  readonly skipped: ReadonlyArray<{
    readonly userId: string;
    readonly reason: string;
    readonly detail?: string;
  }>;
  readonly delivered: ReadonlyArray<{ readonly userId: string; readonly messageId: number }>;
};

type Deps = {
  readonly tasks: TaskRepository;
  readonly members: ProjectMemberRepository;
  readonly send: SendAgentTelegramNotification;
};

// Fan-out TG-нотификации по taskId: грузим задачу → проект → всех members → каждому
// шлём через SendAgentTelegramNotification (там уже все gates — link/started/prefs/dedup/
// audit). Caller (Ralph) — исключается через skipUserId. 404 на отсутствующую задачу.
export class BroadcastTelegramNotificationByTask {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: BroadcastByTaskCommand): Promise<BroadcastByTaskResult> {
    const task = await this.deps.tasks.getById(cmd.taskId);
    if (!task) throw new TaskNotFoundError(cmd.taskId);

    const members = await this.deps.members.listByProject(task.projectId);

    const delivered: { userId: string; messageId: number }[] = [];
    const skipped: { userId: string; reason: string; detail?: string }[] = [];

    for (const m of members) {
      if (cmd.skipUserId && m.userId === cmd.skipUserId) {
        skipped.push({ userId: m.userId, reason: 'self' });
        continue;
      }
      const r = await this.deps.send.execute({
        userId: m.userId,
        text: cmd.text,
        parseMode: cmd.parseMode,
        kind: cmd.kind,
        taskId: cmd.taskId,
        // projectId задачи → авто-действия «Завершить/Комментировать» + reply-комментарий
        // для задачных kinds (см. TASK_ACTION_KINDS в SendAgentTelegramNotification).
        projectId: task.projectId,
        replyMarkup: cmd.replyMarkup,
        skipDedupCheck: cmd.skipDedupCheck,
        skipPrefsCheck: !cmd.respectPrefs,
        ralphQuestionId: cmd.ralphQuestionId,
      });
      switch (r.status) {
        case 'ok':
          delivered.push({ userId: m.userId, messageId: r.messageId });
          break;
        case 'not_connected':
          skipped.push({ userId: m.userId, reason: 'not_connected' });
          break;
        case 'not_started':
          skipped.push({ userId: m.userId, reason: 'not_started' });
          break;
        case 'pref_off':
          skipped.push({ userId: m.userId, reason: 'pref_off' });
          break;
        case 'dedup':
          skipped.push({ userId: m.userId, reason: 'dedup' });
          break;
        case 'forbidden':
          skipped.push({ userId: m.userId, reason: 'forbidden', detail: r.description });
          break;
        case 'rate_limited':
          skipped.push({
            userId: m.userId,
            reason: 'rate_limited',
            detail: `retry_after=${r.retryAfter}`,
          });
          break;
        case 'error':
          skipped.push({ userId: m.userId, reason: 'error', detail: r.description });
          break;
      }
    }
    return { sent: delivered.length, skipped, delivered };
  }
}
