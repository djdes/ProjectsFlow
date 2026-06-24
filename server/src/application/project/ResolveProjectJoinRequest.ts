import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { JoinRequestStatus } from '../../domain/project/ProjectJoinRequest.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectJoinRequestRepository } from './ProjectJoinRequestRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import { requireProjectAccess } from './projectAccess.js';
import type { HubMembershipSync } from '../workspace/HubMembershipSync.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly joinRequests: ProjectJoinRequestRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
  // Синк участников дефолт-хаба владельца (best-effort). Опционально.
  readonly hubSync?: HubMembershipSync;
};

// Владелец (или admin) принимает/отклоняет заявку. Accept → заявитель становится editor.
export class ResolveProjectJoinRequest {
  constructor(private readonly deps: Deps) {}

  async execute(
    joinRequestId: string,
    actorUserId: string,
    accept: boolean,
  ): Promise<{ status: JoinRequestStatus }> {
    const jr = await this.deps.joinRequests.getById(joinRequestId);
    if (!jr) throw new ProjectNotFoundError();

    // Решать может только тот, кто вправе приглашать (owner проекта или admin-bypass).
    await requireProjectAccess(this.deps, jr.projectId, actorUserId, 'invite_member');

    if (jr.status !== 'pending') return { status: jr.status };

    if (accept) {
      const existing = await this.deps.members.findForProject(jr.projectId, jr.requesterUserId);
      if (!existing) {
        await this.deps.members.add({
          projectId: jr.projectId,
          userId: jr.requesterUserId,
          role: 'editor',
        });
        // Копируем глобальные дефолтные notification prefs.
        try {
          const defaults = await this.deps.users.getDefaultNotificationPrefs(jr.requesterUserId);
          if (defaults && Object.keys(defaults).length > 0) {
            await this.deps.members.setNotificationPrefs(jr.projectId, jr.requesterUserId, defaults);
          }
        } catch {
          // Best-effort.
        }
        // Добавляем нового участника в хаб-чат владельца проекта (best-effort).
        try {
          await this.deps.hubSync?.onMemberAdded(jr.projectId, jr.requesterUserId);
        } catch {
          // Синк хаба не должен ломать одобрение заявки.
        }
      }
    }

    const status: Exclude<JoinRequestStatus, 'pending'> = accept ? 'accepted' : 'declined';
    await this.deps.joinRequests.resolve(joinRequestId, status, actorUserId, this.deps.now());
    return { status };
  }
}
