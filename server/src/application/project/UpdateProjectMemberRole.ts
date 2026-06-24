import {
  CannotRemoveSelfAsLastOwnerError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  // Лента действий (best-effort). Опционально.
  readonly activityRecorder?: ActivityRecorder;
};

export type UpdateMemberRoleCommand = {
  readonly projectId: string;
  readonly actorUserId: string;
  readonly targetUserId: string;
  // 'owner' через этот endpoint не выдают — только через TransferProjectOwnership.
  readonly role: Exclude<ProjectRole, 'owner'>;
};

export class UpdateProjectMemberRole {
  constructor(private readonly deps: Deps) {}

  async execute(input: UpdateMemberRoleCommand): Promise<ProjectMembership> {
    // Используем 'invite_member' как proxy: тот же owner-only бекет, что и для invite/remove.
    // Можно завести отдельный 'change_member_role' action — но это будет лишний шум, action
    // имеет ровно ту же required-role.
    await requireProjectAccess(this.deps, input.projectId, input.actorUserId, 'invite_member');

    const target = await this.deps.members.findForProject(input.projectId, input.targetUserId);
    if (!target) throw new ProjectNotFoundError();

    // Защита: нельзя понизить последнего owner'а. input.role гарантированно !== 'owner'
    // (по типу — owner идёт через TransferProjectOwnership). Достаточно проверить, что
    // target сейчас owner и он единственный.
    if (target.role === 'owner') {
      const ownerCount = await this.deps.members.countOwners(input.projectId);
      if (ownerCount <= 1) throw new CannotRemoveSelfAsLastOwnerError();
    }

    const updated = await this.deps.members.updateRole(
      input.projectId,
      input.targetUserId,
      input.role,
    );
    if (!updated) throw new ProjectNotFoundError();

    // Лента действий (best-effort).
    void this.deps.activityRecorder?.record({
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      kind: 'member_role_changed',
      payload: { targetUserId: input.targetUserId, role: input.role },
    });
    return updated;
  }
}
