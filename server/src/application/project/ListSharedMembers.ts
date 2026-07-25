import type {
  ProjectMemberRepository,
  SharedUser,
} from './ProjectMemberRepository.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
};

// Список user'ов, с которыми caller состоит в общих пространствах — для дропдауна
// назначить ответственным во входящих. Без caller'а самого. Охват изолирован по активному
// пространству (как ListProjects): дефолт-хаб → все общие пространства; team → только
// со-участники этого пространства; нет пространства → пусто.
export class ListSharedMembers {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<SharedUser[]> {
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    return ws.kind === 'default'
      ? this.deps.members.listSharedUsers(userId)
      : this.deps.members.listSharedUsersInWorkspace(userId, ws.id);
  }
}
