import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
  readonly users: UserRepository;
};

// Владелец ЧУЖИХ личных входящих, в которых физически лежит задача. Заполняется только
// у подмешанных задач — по нему UI честно подписывает «Личные · <имя>», чтобы не
// выдавать чужую задачу за свою. Для своих задач доски — null.
export type InboxOwner = {
  readonly userId: string;
  readonly displayName: string;
};

export type TaskWithCounts = Task & {
  readonly commitCount: number;
  readonly attachmentCount: number;
  readonly commentCount: number;
  readonly inboxOwner: InboxOwner | null;
};

export class ListTasks {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<TaskWithCounts[]> {
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      ownerUserId,
      'read_project',
    );
    const own = await this.deps.tasks.listByProject(projectId);

    // Правило «я ответственный ⇒ задача в моих личных»: на СВОЮ inbox-доску подмешиваем
    // задачи, за которые отвечает caller, но которые физически лежат в чужих личных
    // входящих (запись остаётся у владельца — он её не теряет). Только для inbox-доски
    // её же владельца: доски именованных проектов возвращают строго свои задачи.
    const foreign =
      project.isInbox && project.ownerId === ownerUserId
        ? await this.foreignInboxTasksAssignedTo(ownerUserId, projectId)
        : [];
    const tasks = [...own, ...foreign.map((f) => f.task)];
    const ownerByTaskId = new Map(foreign.map((f) => [f.task.id, f.inboxOwner]));

    const ids = tasks.map((t) => t.id);
    const commitCounts = await this.deps.taskCommits.countsByTasks(ids);
    const attachmentCounts = await this.deps.attachments.countsByTasks(ids);
    const commentCounts = await this.deps.comments.countsByTasks(ids);
    return tasks.map((t) => ({
      ...t,
      commitCount: commitCounts.get(t.id) ?? 0,
      attachmentCount: attachmentCounts.get(t.id) ?? 0,
      commentCount: commentCounts.get(t.id) ?? 0,
      inboxOwner: ownerByTaskId.get(t.id) ?? null,
    }));
  }

  // Задачи, где userId — ответственный, лежащие в ЧУЖИХ личных входящих. Задачи
  // именованных проектов сюда не попадают: они живут на доске своего проекта, а не в
  // личных (перенос в «Входящие» — отдельный явный жест в верхнем блоке).
  private async foreignInboxTasksAssignedTo(
    userId: string,
    ownInboxProjectId: string,
  ): Promise<{ task: Task; inboxOwner: InboxOwner }[]> {
    const assigned = await this.deps.tasks.listAssignedTo(userId);
    const candidates = assigned.filter((t) => t.projectId !== ownInboxProjectId);
    if (candidates.length === 0) return [];
    const holderIds = [...new Set(candidates.map((t) => t.projectId))];
    const holders = await Promise.all(
      holderIds.map(async (id) => [id, await this.deps.projects.getById(id)] as const),
    );
    // Владельцев резолвим по одному запросу на юзера, а не на задачу.
    const ownerIds = [
      ...new Set(holders.filter(([, p]) => p?.isInbox === true).map(([, p]) => p!.ownerId)),
    ];
    const owners = new Map(
      (await Promise.all(ownerIds.map((id) => this.deps.users.getById(id))))
        .filter((u) => u !== null)
        .map((u) => [u.id, u.displayName]),
    );
    const ownerByProjectId = new Map(
      holders
        .filter(([, p]) => p?.isInbox === true)
        .map(([id, p]) => [id, { userId: p!.ownerId, displayName: owners.get(p!.ownerId) ?? '' }]),
    );
    return candidates.flatMap((task) => {
      const inboxOwner = ownerByProjectId.get(task.projectId);
      return inboxOwner ? [{ task, inboxOwner }] : [];
    });
  }
}
