import { TaskNotFoundError } from '../../domain/task/errors.js';
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
  readonly tasks: Pick<TaskRepository, 'getById'>;
  readonly send: Pick<SendAgentTelegramNotification, 'execute'>;
};

// АДРЕСНАЯ TG-нотификация по taskId: грузим задачу → шлём ЕДИНСТВЕННОМУ ответственному
// (task.assignee, db/113) через SendAgentTelegramNotification (там уже все gates — link/
// started/prefs/dedup/audit). Актор исключается через skipUserId. 404 на отсутствующую задачу.
//
// Раньше здесь был fan-out по members.listByProject(). После перехода на единое пространство
// (unified-workspace) listByProject стал читать членство «насквозь» через workspace_members,
// то есть возвращать ВСЕХ участников пространства — и состояния задач полетели всем подряд.
// Аудитория состояния задачи = тот, за кем задача закреплена; именно это и обещают тексты
// TG-настроек («изменение статуса МОЕЙ задачи», «МОЯ задача завершена»).
// Точечная отправка кому-то ещё по-прежнему доступна агенту через userId-режим
// POST /api/agent/notifications/telegram (см. SendAgentTelegramNotification).
export class BroadcastTelegramNotificationByTask {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: BroadcastByTaskCommand): Promise<BroadcastByTaskResult> {
    const task = await this.deps.tasks.getById(cmd.taskId);
    if (!task) throw new TaskNotFoundError(cmd.taskId);

    const userId = task.assignee.userId;

    // Ответственный сам и сделал действие — уведомлять его о собственном шаге не нужно.
    if (cmd.skipUserId && userId === cmd.skipUserId) {
      return { sent: 0, skipped: [{ userId, reason: 'self' }], delivered: [] };
    }

    const delivered: { userId: string; messageId: number }[] = [];
    const skipped: { userId: string; reason: string; detail?: string }[] = [];

    const r = await this.deps.send.execute({
      userId,
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
        delivered.push({ userId, messageId: r.messageId });
        break;
      case 'not_connected':
        skipped.push({ userId, reason: 'not_connected' });
        break;
      case 'not_started':
        skipped.push({ userId, reason: 'not_started' });
        break;
      case 'pref_off':
        skipped.push({ userId, reason: 'pref_off' });
        break;
      case 'dedup':
        skipped.push({ userId, reason: 'dedup' });
        break;
      case 'forbidden':
        skipped.push({ userId, reason: 'forbidden', detail: r.description });
        break;
      case 'rate_limited':
        skipped.push({ userId, reason: 'rate_limited', detail: `retry_after=${r.retryAfter}` });
        break;
      case 'error':
        skipped.push({ userId, reason: 'error', detail: r.description });
        break;
    }
    return { sent: delivered.length, skipped, delivered };
  }
}
