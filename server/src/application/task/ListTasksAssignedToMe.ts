import { can } from '../../domain/project/permissions.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
};

// Строка блока «Поручено мне»: задача (с приклеенной активной делегацией) + контекст
// проекта для группировки + canModify (можно ли отметить выполненной) + счётчики.
export type AssignedTaskView = {
  readonly task: Task;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly delegation: TaskDelegation;
  // accepted + (inbox-делегат ИЛИ editor+ участник именованного проекта). Для pending
  // всегда false (сначала «Принять»). UI делает чекбокс disabled при false.
  readonly canModify: boolean;
  readonly commitCount: number;
  readonly attachmentCount: number;
  readonly commentCount: number;
};

// Все активные (pending|accepted) делегации НА текущего пользователя, по всем проектам.
// Авторизация встроена в репозиторий (фильтр delegate_user_id = userId). Группировку
// по проекту делает клиент (это чистая презентация).
export class ListTasksAssignedToMe {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const rows = await this.deps.delegations.listAssignedTo(userId);
    // Отбрасываем строки именованных проектов, где делегата уже убрали из проекта
    // (delegateRole === null && !isInbox). Inbox-строки оставляем (там role всегда null).
    const visible = rows.filter((r) => r.isInbox || r.delegateRole !== null);

    const ids = visible.map((r) => r.taskId);
    const [taskList, commitCounts, attachmentCounts, commentCounts] = await Promise.all([
      this.deps.tasks.listByIds(ids),
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids),
      this.deps.comments.countsByTasks(ids),
    ]);
    const taskById = new Map(taskList.map((t) => [t.id, t]));

    const out: AssignedTaskView[] = [];
    for (const r of visible) {
      const task = taskById.get(r.taskId);
      if (!task) continue; // задача удалена между запросами — пропускаем
      out.push({
        task: { ...task, delegation: r.delegation },
        projectId: r.projectId,
        projectName: r.projectName,
        isInbox: r.isInbox,
        delegation: r.delegation,
        canModify:
          r.delegation.status === 'accepted' &&
          (r.isInbox || (r.delegateRole !== null && can(r.delegateRole, 'move_task'))),
        commitCount: commitCounts.get(r.taskId) ?? 0,
        attachmentCount: attachmentCounts.get(r.taskId) ?? 0,
        commentCount: commentCounts.get(r.taskId) ?? 0,
      });
    }
    return out;
  }
}
