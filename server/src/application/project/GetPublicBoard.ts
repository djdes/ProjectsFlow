import { TASK_STATUSES, type Task } from '../../domain/task/Task.js';
import type { PublicBoard, PublicTask } from '../../domain/project/PublicBoard.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
};

// Публичная выдача обложки: `gradient:<id>` и внешние URL — как есть; загруженный файл
// проекта (/api/projects/:id/cover/...) переписываем на анонимный роут, чтобы аноним мог
// получить картинку без авторизации и без утечки внутреннего projectId.
export function publicCoverUrl(slug: string, coverUrl: string | null): string | null {
  if (!coverUrl) return null;
  if (coverUrl.startsWith('gradient:')) return coverUrl;
  if (coverUrl.startsWith('/api/projects/')) return `/api/public/boards/${slug}/cover`;
  return coverUrl;
}

// Whitelist полей задачи — граница приватности (см. PublicBoard).
function toPublicTask(t: Task): PublicTask {
  return {
    id: t.id,
    description: t.description,
    icon: t.icon,
    cover: t.cover,
    coverPosition: t.coverPosition,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
  };
}

// Собрать публичную доску по slug. Возвращает null, если проект не найден или не
// опубликован (is_public=0) — анонимный роут мапит это в 404 (не палим существование).
export class GetPublicBoard {
  constructor(private readonly deps: Deps) {}

  async execute(slug: string): Promise<PublicBoard | null> {
    const project = await this.deps.projects.getBySlug(slug);
    if (!project || !project.isPublic || !project.publicSlug) return null;

    const tasks = await this.deps.tasks.listByProject(project.id);
    const columns = TASK_STATUSES.map((status) => ({
      status,
      tasks: tasks.filter((t) => t.status === status).map(toPublicTask),
    }));

    return {
      slug: project.publicSlug,
      name: project.name,
      icon: project.icon,
      description: project.description,
      coverUrl: publicCoverUrl(project.publicSlug, project.coverUrl),
      coverPosition: project.coverPosition,
      indexing: project.publicIndexing,
      appearance: project.publicAppearance,
      columns,
    };
  }
}
