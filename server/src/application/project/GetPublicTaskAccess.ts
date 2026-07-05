import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
};

export type PublicTaskAccess = {
  readonly projectId: string;
  readonly isMember: boolean;
};

// Гейт для отдельной страницы задачи /p/:slug/t/:taskId. Проект уже публичный, поэтому раскрывать
// projectId + факт членства безопасно. userId = null для анонима (isMember=false). null (→404),
// если проект не публичный или задача не его. См. spec public-task-detail-and-gate.
export class GetPublicTaskAccess {
  constructor(private readonly deps: Deps) {}

  async execute(
    slug: string,
    taskId: string,
    userId: string | null,
  ): Promise<PublicTaskAccess | null> {
    const project = await this.deps.projects.getBySlug(slug);
    if (!project || !project.isPublic) return null;

    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== project.id) return null;

    let isMember = false;
    if (userId) {
      const membership = await this.deps.members.findForProject(project.id, userId);
      isMember = membership !== null;
    }

    return { projectId: project.id, isMember };
  }
}
