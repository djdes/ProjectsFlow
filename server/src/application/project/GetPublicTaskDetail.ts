import { rewriteAttachmentUrls } from '../../domain/project/publicAttachments.js';
import type { PublicComment, PublicTaskDetail } from '../../domain/project/PublicBoard.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskCommentRepository } from '../task/TaskCommentRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly users: UserRepository;
};

// Read-only деталь задачи публичной доски: тело (с переписанными URL картинок) + комментарии.
// Только человеческие комментарии (actorKind='user') — agent/system-логи воркера наружу не светим.
// Возвращает null (→ 404), если проект не публичный или задача не принадлежит ему. См. spec.
export class GetPublicTaskDetail {
  constructor(private readonly deps: Deps) {}

  async execute(slug: string, taskId: string): Promise<PublicTaskDetail | null> {
    const project = await this.deps.projects.getBySlug(slug);
    if (!project || !project.isPublic) return null;

    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== project.id) return null;

    const raw = await this.deps.comments.listByTask(taskId);
    const humanComments = raw.filter((c) => c.actorKind === 'user');

    const comments: PublicComment[] = [];
    for (const c of humanComments) {
      const author = await this.deps.users.getById(c.ownerUserId);
      comments.push({
        id: c.id,
        authorDisplayName: author?.displayName ?? 'Участник',
        authorAvatarUrl: author?.avatarUrl ?? null,
        body: rewriteAttachmentUrls(c.body, slug),
        createdAt: c.createdAt.toISOString(),
      });
    }

    return {
      id: task.id,
      description: task.description ? rewriteAttachmentUrls(task.description, slug) : null,
      icon: task.icon,
      cover: task.cover,
      coverPosition: task.coverPosition,
      status: task.status,
      priority: task.priority,
      deadline: task.deadline,
      comments,
    };
  }
}
