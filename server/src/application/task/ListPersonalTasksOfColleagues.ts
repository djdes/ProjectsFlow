import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { AssignedTaskView } from './ListTasksAssignedToMe.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
};

/**
 * Личные (inbox) задачи коллег caller'а — колонки «Личные · <Имя>» во входящих.
 *
 * Граница видимости: круг коллег берётся ТОЛЬКО из members.listSharedUsers (тот же
 * источник, что у ListSharedMembers) — это участники общих с caller'ом ПРОСТРАНСТВ,
 * без caller'а самого. Пользователь, с которым нет общего пространства, в выборку не
 * попадает ни при каких входных данных: список owner'ов формирует сервер, клиент не
 * передаёт ни одного id. Задачи из НЕ-inbox проектов сюда не попадают по построению
 * (берём только projects.is_inbox = 1 владельца-коллеги).
 *
 * Право на действие совпадает с правом на просмотр: раз задача видна в этом списке, её можно
 * перевести в другую колонку и удалить (см. isInboxColleague в taskAuthorization — там та же
 * граница listSharedUsers). Раньше здесь стоял canModify=false, и карточка выглядела живой,
 * а действия молча упирались в 404.
 */
export class ListPersonalTasksOfColleagues {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const colleagues = await this.deps.members.listSharedUsers(userId);
    const colleagueIds = colleagues.map((c) => c.id).filter((id) => id !== userId);
    if (colleagueIds.length === 0) return [];

    const inboxes = await this.deps.projects.listInboxesByOwners(colleagueIds);
    // Defense in depth: repo-фильтр по ownerId уже отсёк чужих, но повторная проверка
    // делает невозможной утечку при будущей правке запроса.
    const allowed = new Set(colleagueIds);
    const visibleInboxes = inboxes.filter(
      (p) => p.isInbox && p.ownerId !== userId && allowed.has(p.ownerId),
    );
    if (visibleInboxes.length === 0) return [];

    const projectById = new Map(visibleInboxes.map((p) => [p.id, p]));
    // listByProjects отдаёт только живые задачи (deleted_at IS NULL, db/134).
    const taskList = await this.deps.tasks.listByProjects([...projectById.keys()]);
    // Задачи, где ответственный — сам caller, уже показаны во вкладке «Мне».
    const visible = taskList.filter(
      (t) => projectById.has(t.projectId) && t.assignee.userId !== userId,
    );

    const ids = visible.map((t) => t.id);
    const [commitCounts, attachmentCounts, commentCounts] = await Promise.all([
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids),
      this.deps.comments.countsByTasks(ids),
    ]);

    return visible.map((task) => {
      const project = projectById.get(task.projectId)!;
      return {
        task,
        projectId: project.id,
        projectName: project.name,
        isInbox: true,
        // Коллега по общему пространству: видит задачу — значит может менять статус и удалять.
        canModify: true,
        commitCount: commitCounts.get(task.id) ?? 0,
        attachmentCount: attachmentCounts.get(task.id) ?? 0,
        commentCount: commentCounts.get(task.id) ?? 0,
      };
    });
  }
}
