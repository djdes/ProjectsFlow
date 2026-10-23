import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { Project } from '../../domain/project/Project.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { AssignedTaskView } from './ListTasksAssignedToMe.js';
import { requireTaskModifyAccess, requireTaskReadAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly users: UserRepository;
};

// Older questions are not shown: a comment nobody answered for a month is background,
// and on rollout the whole history would light up at once.
export const AWAITING_REPLY_WINDOW_DAYS = 30;

const EXCERPT_LENGTH = 200;

export type AwaitingReplyView = AssignedTaskView & {
  // The latest comment addressed to the caller in this task.
  readonly question: {
    readonly commentId: string;
    readonly authorUserId: string;
    readonly authorDisplayName: string;
    readonly excerpt: string;
    readonly askedAt: Date;
  };
};

function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
}

/**
 * Задачи, где caller'у адресовали комментарий (выбрали в «Кого уведомить» или упомянули
 * через @), а он в этой задаче ещё не ответил. Руководитель открывает «Входящие», включает
 * фильтр и отвечает по очереди; задача уходит из списка с его первым комментарием в ней.
 *
 * Список не ограничен задачами, где caller исполнитель: вопрос руководителю обычно задают
 * в чужой задаче. Видно только то, что caller вправе открыть, в активном пространстве;
 * закрытые и удалённые задачи не показываем.
 */
export class ListTasksAwaitingMyReply {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, now: Date = new Date()): Promise<AwaitingReplyView[]> {
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    const since = new Date(now.getTime() - AWAITING_REPLY_WINDOW_DAYS * 24 * 3600_000);
    const comments = await this.deps.comments.listUnansweredAddressedTo(userId, since);

    // Comments arrive newest first: the first one per task is its latest question.
    const latestByTask = new Map<string, TaskComment>();
    for (const c of comments) if (!latestByTask.has(c.taskId)) latestByTask.set(c.taskId, c);

    const projectCache = new Map<string, Promise<Project | null>>();
    const projectOf = (id: string): Promise<Project | null> => {
      let p = projectCache.get(id);
      if (!p) projectCache.set(id, (p = this.deps.projects.getById(id)));
      return p;
    };

    const resolved = await Promise.all(
      [...latestByTask.values()].map(async (question) => {
        const task = await this.deps.tasks.getById(question.taskId);
        if (!task || task.status === 'done') return null;
        const project = await projectOf(task.projectId);
        if (!project || project.workspaceId !== ws.id) return null;
        try {
          await requireTaskReadAccess(this.deps, project.id, task.id, userId);
        } catch {
          return null;
        }
        const canModify = await requireTaskModifyAccess(this.deps, project.id, task.id, userId, 'move_task').then(
          () => true,
          () => false,
        );
        return { task, project, question, canModify };
      }),
    );
    const visible = resolved.filter(
      (x): x is { task: Task; project: Project; question: TaskComment; canModify: boolean } => x !== null,
    );
    if (visible.length === 0) return [];

    const ids = visible.map((v) => v.task.id);
    const userIds = [
      ...new Set([
        ...visible.map((v) => v.question.ownerUserId),
        ...visible.filter((v) => v.project.isInbox).map((v) => v.project.ownerId),
      ]),
    ];
    const [commitCounts, attachmentCounts, commentCounts, users] = await Promise.all([
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids),
      this.deps.comments.countsByTasks(ids),
      Promise.all(userIds.map((id) => this.deps.users.getById(id))),
    ]);
    const names = new Map(users.filter((u) => u !== null).map((u) => [u.id, u.displayName]));

    return visible.map(({ task, project, question, canModify }) => ({
      task,
      projectId: project.id,
      projectName: project.name,
      isInbox: project.isInbox,
      inboxOwner: project.isInbox
        ? { userId: project.ownerId, displayName: names.get(project.ownerId) ?? '' }
        : null,
      canModify,
      commitCount: commitCounts.get(task.id) ?? 0,
      attachmentCount: attachmentCounts.get(task.id) ?? 0,
      commentCount: commentCounts.get(task.id) ?? 0,
      question: {
        commentId: question.id,
        authorUserId: question.ownerUserId,
        authorDisplayName: names.get(question.ownerUserId) ?? '',
        excerpt: excerptOf(question.body),
        askedAt: question.createdAt,
      },
    }));
  }
}
