import type { Project } from '../../domain/project/Project.js';
import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import { hasOwnerRights } from '../../domain/project/permissions.js';
import { normalizeAliases } from '../telegram/composer/projectHints.js';
import { requireProjectAccess } from './projectAccess.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export type ProjectGroupHints = {
  readonly aliases: readonly string[];
  readonly shortDescription: string | null;
};

// Привычные названия и короткое описание проекта (db/192): по ним бот выбирает проект из
// сообщения рабочей Telegram-группы, описание уходит ИИ-выбору. Меняют владелец/руководитель.
export class SetProjectGroupHints {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, actorUserId: string, hints: ProjectGroupHints): Promise<Project> {
    const { project, membership } = await requireProjectAccess(this.deps, projectId, actorUserId, 'read_project');
    if (!hasOwnerRights(membership.role)) throw new InsufficientProjectRoleError(membership.role, 'set_group_hints');
    if (project.isInbox) throw new ProjectNotFoundError();
    const description = hints.shortDescription?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '';
    const updated = await this.deps.projects.update(projectId, {
      aliases: normalizeAliases(hints.aliases),
      shortDescription: description || null,
    });
    if (!updated) throw new ProjectNotFoundError();
    return updated;
  }
}
