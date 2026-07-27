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
  readonly tasks: Pick<TaskRepository, 'getById'>;
  readonly send: Pick<SendAgentTelegramNotification, 'execute'>;
  // Руководители пространства — вторая (и единственная кроме ответственного) аудитория.
  readonly members: Pick<ProjectMemberRepository, 'listLeadUserIdsForProject'>;
};

// Какие события пересылаются руководителю. Всё остальное (новая задача, комментарии,
// упоминания) в командный поток НЕ идёт: руководителю нужен статус работы, а не лента.
const TEAM_FORWARD_KINDS: ReadonlySet<string> = new Set([
  'status_change',
  'task_done',
  'task_blocked',
  'ralph_question',
]);

// Kind командной копии = исходный с префиксом. Даёт своё окно дедупа и свой pref-ключ
// (teamStatusChange), поэтому руководитель может выключить командный поток, не теряя
// уведомлений по собственным задачам.
export function teamKind(kind: string): string {
  return `team_${kind}`;
}

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

    const delivered: { userId: string; messageId: number }[] = [];
    const skipped: { userId: string; reason: string; detail?: string }[] = [];

    // Ответственный сам и сделал действие — уведомлять его о собственном шаге не нужно.
    // Руководителям копия уходит в любом случае: ровно этот случай («Олег перевёл свою
    // задачу в готово») им и нужен.
    if (cmd.skipUserId && userId === cmd.skipUserId) {
      skipped.push({ userId, reason: 'self' });
      await this.notifyLeads(cmd, task, delivered, skipped);
      return { sent: delivered.length, skipped, delivered };
    }

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

    await this.notifyLeads(cmd, task, delivered, skipped);
    return { sent: delivered.length, skipped, delivered };
  }

  // Командная копия события руководителям пространства — в ЛИЧНЫЙ чат каждого (send
  // работает только с личной привязкой юзера), поэтому в групповые чаты ничего не утекает.
  // Ошибки доставки одному руководителю не мешают остальным и не влияют на ответ.
  private async notifyLeads(
    cmd: BroadcastByTaskCommand,
    task: { projectId: string; assignee: { userId: string; displayName: string } },
    delivered: { userId: string; messageId: number }[],
    skipped: { userId: string; reason: string; detail?: string }[],
  ): Promise<void> {
    if (!TEAM_FORWARD_KINDS.has(cmd.kind)) return;
    const leadIds = await this.deps.members.listLeadUserIdsForProject(task.projectId);
    const recipients = [...new Set(leadIds)].filter(
      (id) => id !== task.assignee.userId && id !== cmd.skipUserId,
    );
    if (recipients.length === 0) return;

    // Префикс с именем ответственного: без него командный поток неотличим от
    // уведомлений по собственным задачам руководителя.
    const text = `👤 <b>${escapeHtml(task.assignee.displayName)}</b>\n${cmd.text}`;
    for (const leadId of recipients) {
      const res = await this.deps.send.execute({
        userId: leadId,
        text,
        parseMode: cmd.parseMode ?? 'HTML',
        kind: teamKind(cmd.kind),
        taskId: cmd.taskId,
        projectId: task.projectId,
        // Клавиатуру ответственного не пересылаем: кнопки вида «Ответить агенту»
        // адресованы исполнителю, не наблюдателю.
        skipDedupCheck: cmd.skipDedupCheck,
        // Prefs руководителя (teamStatusChange) уважаем всегда, даже если для
        // ответственного caller просил override.
        skipPrefsCheck: false,
      });
      if (res.status === 'ok') delivered.push({ userId: leadId, messageId: res.messageId });
      else skipped.push({ userId: leadId, reason: res.status });
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}
