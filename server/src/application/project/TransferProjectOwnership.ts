import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export type TransferOwnershipCommand = {
  readonly projectId: string;
  readonly actorUserId: string; // текущий owner
  readonly toUserId: string;    // новый owner; должен уже быть member'ом
};

export class TransferProjectOwnership {
  constructor(private readonly deps: Deps) {}

  async execute(input: TransferOwnershipCommand): Promise<void> {
    await requireProjectAccess(this.deps, input.projectId, input.actorUserId, 'transfer_ownership');

    if (input.toUserId === input.actorUserId) return; // noop

    const target = await this.deps.members.findForProject(input.projectId, input.toUserId);
    if (!target) throw new ProjectNotFoundError();

    // Без явной транзакции: пара updateRole'ов. Если второй упадёт — окажемся
    // с двумя owner'ами; это безопасно (никто не теряет доступ), и UI это покажет.
    // Drizzle TX можно подключить позже — пока exposure минимален.
    await this.deps.members.updateRole(input.projectId, input.toUserId, 'owner');
    await this.deps.members.updateRole(input.projectId, input.actorUserId, 'editor');
  }
}
