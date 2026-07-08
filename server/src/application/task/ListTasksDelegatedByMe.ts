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

// Все активные (pending|accepted) делегации, СОЗДАННЫЕ текущим пользователем, по всем
// проектам — вкладка «Другим» блока делегирования. Зеркало ListTasksAssignedToMe: тот же
// view-shape (клиент рисует те же карточки), фильтрацию по конкретному делегату делает
// клиент (чистая презентация).
export class ListTasksDelegatedByMe {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const rows = await this.deps.delegations.listDelegatedBy(userId);
    // Видимость гейтится по СОБСТВЕННОМУ членству делегатора: если его убрали из
    // именованного проекта, строка прячется — иначе endpoint отдавал бы живые данные
    // задачи в обход read_project-гейта (у ListTasksAssignedToMe ту же роль играет
    // delegateRole, там caller = делегат). Строки с удалённым ДЕЛЕГАТОМ, наоборот,
    // оставляем: такие «зависшие» делегации продолжают блокировать повторное
    // делегирование (findActiveForTask), и делегатор должен их видеть, чтобы отозвать.
    const visible = rows.filter((r) => r.isInbox || r.creatorRole !== null);

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
        // Делегатор может закрыть СВОЮ задачу сам, не дожидаясь делегата: inbox — это его
        // личный проект (owner), в именованном — если его роль позволяет move_task. Гейта
        // по accepted нет (в отличие от делегата): задача принадлежит делегатору.
        canModify:
          r.isInbox || (r.creatorRole !== null && can(r.creatorRole, 'move_task')),
        commitCount: commitCounts.get(r.taskId) ?? 0,
        attachmentCount: attachmentCounts.get(r.taskId) ?? 0,
        commentCount: commentCounts.get(r.taskId) ?? 0,
      });
    }
    return out;
  }
}
