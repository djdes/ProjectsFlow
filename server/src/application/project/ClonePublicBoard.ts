import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { CreateProject } from './CreateProject.js';
import type { CreateTask } from '../task/CreateTask.js';

// Публичная доска не найдена/не опубликована — роут мапит в 404.
export class ClonePublicBoardNotFoundError extends Error {
  constructor(slug: string) {
    super(`public board not found: ${slug}`);
    this.name = 'ClonePublicBoardNotFoundError';
  }
}

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly createProject: CreateProject;
  readonly createTask: CreateTask;
};

// «Дублировать» публичную доску в аккаунт гостя (после логина): создаём новый проект-копию
// (имя/иконка/обложка/описание) в активном пространстве пользователя и переносим задачи
// (описание/иконка/обложка/статус/срок/приоритет). Комментарии/вложения не копируем —
// их и нет в публичной выдаче (граница приватности на сервере).
export class ClonePublicBoard {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, slug: string): Promise<{ projectId: string }> {
    const src = await this.deps.projects.getBySlug(slug);
    if (!src || !src.isPublic || !src.publicSlug) throw new ClonePublicBoardNotFoundError(slug);

    const srcTasks = await this.deps.tasks.listByProject(src.id);

    const proj = await this.deps.createProject.execute({ ownerId: userId, name: src.name });
    // Файловую обложку проекта (/api/projects/...) НЕ копируем — она принадлежит исходному
    // проекту и новому владельцу недоступна; переносим только градиент/внешний URL.
    const cover = src.coverUrl && !src.coverUrl.startsWith('/api/') ? src.coverUrl : null;
    await this.deps.projects.update(proj.id, {
      icon: src.icon,
      description: src.description,
      coverUrl: cover,
      coverPosition: src.coverPosition,
    });

    // Переносим задачи по колонкам, сохраняя порядок (цепочка afterTaskId).
    const byStatus = new Map<TaskStatus, Task[]>();
    for (const t of srcTasks) {
      const arr = byStatus.get(t.status) ?? [];
      arr.push(t);
      byStatus.set(t.status, arr);
    }
    for (const arr of byStatus.values()) {
      arr.sort((a, b) => a.position - b.position);
      let after: string | null = null;
      for (const t of arr) {
        const description = (t.description ?? '').trim() || 'Без названия';
        const taskCover = t.cover && !t.cover.startsWith('/api/') ? t.cover : null;
        const created = await this.deps.createTask.execute({
          projectId: proj.id,
          ownerUserId: userId,
          description,
          icon: t.icon,
          cover: taskCover,
          coverPosition: t.coverPosition,
          status: t.status,
          deadline: t.deadline,
          // Копия доски должна повторять источник: задача без срока остаётся без срока,
          // а не получает дефолтное «сегодня».
          preserveEmptyDeadline: true,
          priority: t.priority,
          afterTaskId: after,
        });
        after = created.id;
      }
    }

    return { projectId: proj.id };
  }
}
