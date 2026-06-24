import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type {
  ProjectMemberRepository,
  ProjectWithRole,
} from './ProjectMemberRepository.js';

// Multi-tenancy с дефолт-хабом:
//  • Активное пространство kind='default' (личный хаб) → возвращаем ВСЕ проекты юзера
//    (свои + куда приглашён), независимо от их workspace_id. Это «всё моё» представление.
//  • Активное пространство kind='team' → срез: только проекты этого пространства, где юзер состоит.
// В обоих случаях — его role + read-model счётчики (members/tasks).
export type { ProjectWithRole };

type ActiveWorkspace = { readonly id: string; readonly kind: WorkspaceKind };

type Deps = {
  readonly members: ProjectMemberRepository;
  // Резолвит активное пространство юзера (id + kind). null = нет пространств → пустой список.
  readonly resolveActiveWorkspace: (userId: string) => Promise<ActiveWorkspace | null>;
};

export class ListProjects {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<ProjectWithRole[]> {
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    if (ws.kind === 'default') {
      // Дефолт-хаб агрегирует все проекты юзера (любое пространство).
      return this.deps.members.listProjectsForUser(userId);
    }
    return this.deps.members.listProjectsForUserInWorkspace(userId, ws.id);
  }
}
