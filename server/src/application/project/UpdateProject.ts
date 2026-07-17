import type { Project } from '../../domain/project/Project.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { ActivityFieldChange } from '../../domain/activity/ActivityEvent.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository, UpdateProjectInput } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

export type UpdateProjectCommand = {
  readonly id: string;
  readonly ownerId: string;
  readonly patch: UpdateProjectInput;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  // Логируем правки проекта в ленту изменений (best-effort, опционально).
  readonly activity?: ActivityRecorder;
};

export class UpdateProject {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: UpdateProjectCommand): Promise<Project> {
    // ownerId — название историческое (сохраняем сигнатуру для presentation); на самом
    // деле это просто userId. Update_project требует editor+ — viewer не пройдёт.
    await requireProjectAccess(this.deps, cmd.id, cmd.ownerId, 'update_project');
    const existing = await this.deps.projects.getById(cmd.id);
    const linkedRepo =
      cmd.patch.gitRepoUrl === undefined
        ? undefined
        : cmd.patch.gitRepoUrl
          ? githubFullName(cmd.patch.gitRepoUrl)
          : null;
    const patch: UpdateProjectInput = {
      ...cmd.patch,
      ...(linkedRepo !== undefined ? { appRepoFullName: linkedRepo } : {}),
    };
    const updated = await this.deps.projects.update(cmd.id, patch);
    if (!updated) throw new ProjectNotFoundError();

    // Логируем изменённые поля проекта (Notion-style дифф).
    if (this.deps.activity && existing) {
      const changes: ActivityFieldChange[] = [];
      if (cmd.patch.name !== undefined && existing.name !== updated.name) {
        changes.push({ field: 'name', old: existing.name, new: updated.name });
      }
      if (cmd.patch.description !== undefined && existing.description !== updated.description) {
        changes.push({ field: 'description', old: existing.description, new: updated.description });
      }
      if (cmd.patch.coverUrl !== undefined && existing.coverUrl !== updated.coverUrl) {
        changes.push({ field: 'cover', old: existing.coverUrl, new: updated.coverUrl });
      }
      if (changes.length > 0) {
        await this.deps.activity.record({
          projectId: cmd.id,
          actorUserId: cmd.ownerId,
          kind: 'project_updated',
          payload: { projectName: updated.name, changes },
        });
      }
    }
    return updated;
  }
}

function githubFullName(url: string): string | null {
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[?#/]|$)/i);
  return match ? `${match[1]}/${match[2]}` : null;
}
