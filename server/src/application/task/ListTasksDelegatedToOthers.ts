import { can } from '../../domain/project/permissions.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { AssignedTaskView } from './ListTasksAssignedToMe.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
};

// Все активные (accepted) делегации «кому-то другому», ВИДИМЫЕ текущему
// пользователю, по всем проектам — вкладка «Другим» блока делегирования: участник
// именованного проекта видит все делегирования в нём (от любого любому, как на доске);
// inbox — только собственные исходящие. Строки «делегат = caller» исключены («Для меня»).
// Тот же view-shape, что у ListTasksAssignedToMe (клиент рисует те же карточки);
// фильтры (от кого/кому/проект) — на клиенте (чистая презентация).
export class ListTasksDelegatedToOthers {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const rows = await this.deps.delegations.listDelegatedToOthers(userId);
    // Видимость гейтится по СОБСТВЕННОМУ членству caller'а: без него строка именованного
    // проекта прячется — иначе endpoint отдавал бы живые данные задачи в обход
    // read_project-гейта. (SQL уже enforc'ит это — фильтр остаётся как защита в глубину.)
    // Строки с удалённым из проекта ДЕЛЕГАТОМ оставляем: такие «зависшие» делегации
    // продолжают блокировать повторное делегирование (findActiveForTask) — их надо видеть.
    const visible = rows.filter((r) => r.isInbox || r.callerRole !== null);

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
        // canModify — по роли caller'а в проекте задачи (editor+ двигает любые задачи
        // доски, включая чужие делегирования); inbox-строки здесь только собственные
        // (caller = owner инбокса) → true. Гейта по accepted нет.
        canModify:
          r.isInbox || (r.callerRole !== null && can(r.callerRole, 'move_task')),
        commitCount: commitCounts.get(r.taskId) ?? 0,
        attachmentCount: attachmentCounts.get(r.taskId) ?? 0,
        commentCount: commentCounts.get(r.taskId) ?? 0,
      });
    }
    return out;
  }
}
