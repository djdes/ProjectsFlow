import type { TaskChange } from '../../domain/notifications/TaskChange.js';
import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import {
  AssigneeNotProjectMemberError,
  AssigneeNotSharedMemberError,
} from '../../domain/task/errors.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import { resetChecklist } from '../../domain/task/checklist.js';
import { nextOccurrenceAfterDeadline } from '../../domain/task/TaskRecurrence.js';
import type { CreateTask, CreateTaskCommand } from './CreateTask.js';
import type { TaskRecurrenceLedger } from './TaskRepository.js';

type Deps = {
  readonly ledger: TaskRecurrenceLedger;
  // Копию ставим тем же use-case'ом, что и любую новую задачу: позиция, приёмка, воркер,
  // история версий, уведомления «создана задача» и лента действий — без особых путей.
  readonly createTask: Pick<CreateTask, 'execute'>;
  readonly idGen: () => string;
  readonly now?: () => Date;
  // Realtime: участникам проекта — «в проекте изменились задачи» (как после POST /tasks).
  readonly onCreated?: (task: Task) => void;
  readonly logger?: Pick<Console, 'warn'>;
};

// Статус новой копии — тот же, с которым люди заводят задачи: «Черновики». Окно «Создать
// задачу», композер «Входящих» и MCP создают именно в backlog. Колонка воркера ('todo')
// запускала бы агента без явного действия человека, а это запрещено (см. CLAUDE.md).
export const RECURRING_TASK_INITIAL_STATUS: TaskStatus = 'backlog';

// Ошибки, после которых имеет смысл попробовать поставить копию от имени другого человека:
// у этого нет права создавать задачи в проекте (или он из проекта ушёл).
function isAccessError(error: unknown): boolean {
  return error instanceof ProjectNotFoundError || error instanceof InsufficientProjectRoleError;
}

function isAssigneeError(error: unknown): boolean {
  return error instanceof AssigneeNotProjectMemberError || error instanceof AssigneeNotSharedMemberError;
}

/**
 * Повторяющиеся задачи (db/185), Todoist-style «every»: когда задачу с правилом повтора
 * переводят в 'done' — любым путём (чекбокс, drag, приёмка руководителем, массовые
 * действия, MCP/агент, Telegram, письмо, close-proposal, commit-sync) — ставим следующую.
 *
 * Слушает центральный поток изменений задач (TaskVersionRecorder.onChanged): туда сходятся
 * все пути записи через TaskRepository, поэтому новые пути закрытия задачи подхватываются
 * без правок здесь.
 *
 * Идемпотентность: перед созданием копии атомарно занимаем слот recurrence_next_task_id у
 * выполненной задачи. «Выполнить → вернуть в работу → выполнить» второй копии не даёт, как
 * и два параллельных «выполнено».
 */
export class SpawnNextRecurringTask {
  constructor(private readonly deps: Deps) {}

  async onTaskChanged(change: TaskChange): Promise<Task | null> {
    const { task, previous } = change;
    if (!previous || previous.status === 'done' || task.status !== 'done') return null;
    if (!task.recurrence || task.recurrenceNextTaskId) return null;

    const reservation = this.deps.idGen();
    if (!(await this.deps.ledger.claimNextOccurrence(task.id, reservation))) return null;

    let created: Task | null = null;
    try {
      created = await this.createNext(task, change.actorUserId);
    } finally {
      // Резерв → id созданной копии; не получилось создать — освобождаем слот, чтобы
      // следующее выполнение могло попробовать снова.
      await this.deps.ledger.replaceNextOccurrence(task.id, reservation, created?.id ?? null);
    }
    if (created) this.deps.onCreated?.(created);
    return created;
  }

  private async createNext(task: Task, actorUserId: string | null): Promise<Task | null> {
    const rule = task.recurrence!;
    const now = (this.deps.now ?? (() => new Date()))();
    const base: Omit<CreateTaskCommand, 'ownerUserId'> = {
      projectId: task.projectId,
      description: resetChecklist(task.description ?? '').trim() || 'Повторяющаяся задача',
      icon: task.icon,
      status: RECURRING_TASK_INITIAL_STATUS,
      ralphMode: task.ralphMode,
      assigneeUserId: task.assignee.userId,
      deadline: nextOccurrenceAfterDeadline(rule, task.deadline, now),
      parentTaskId: task.parentTaskId,
      priority: task.priority,
      taskType: task.taskType,
      // Приёмка и видимость в общем проекте считаются от пространства создания — то же, что у
      // выполненной задачи (CreateTask проверит, что ставящий копию в нём участник).
      originWorkspaceId: task.originWorkspaceId ?? null,
      recurrence: rule,
    };

    // От чьего имени ставим: автор серии (повтор — его договорённость), затем тот, кто
    // закрыл задачу, затем исполнитель. Первый, у кого есть право создавать задачи.
    const owners = [...new Set([task.createdBy, actorUserId, task.assignee.userId])].filter(
      (id): id is string => !!id,
    );
    let lastError: unknown = null;
    for (const ownerUserId of owners) {
      try {
        return await this.deps.createTask.execute({ ...base, ownerUserId });
      } catch (error) {
        lastError = error;
        if (isAssigneeError(error)) {
          // Исполнитель больше не участник проекта — серия продолжается на ставящем.
          try {
            return await this.deps.createTask.execute({ ...base, ownerUserId, assigneeUserId: ownerUserId });
          } catch (retryError) {
            lastError = retryError;
            if (!isAccessError(retryError)) break;
            continue;
          }
        }
        if (!isAccessError(error)) break;
      }
    }
    (this.deps.logger ?? console).warn('[recurring-task] next occurrence was not created', task.id, lastError);
    return null;
  }
}
