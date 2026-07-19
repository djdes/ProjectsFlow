import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
};

// Корзина проекта: единственное место, где мягко удалённые задачи видны (db/134).
export class ListTrashedTasks {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, actorUserId: string): Promise<Task[]> {
    await requireProjectAccess(this.deps, projectId, actorUserId, 'read_project');
    return this.deps.tasks.listTrashedByProject(projectId);
  }
}
