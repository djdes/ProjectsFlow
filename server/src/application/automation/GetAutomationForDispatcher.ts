import { requireDispatcherAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { AutomationRepository } from './AutomationRepository.js';
import {
  buildDispatcherView,
  type AutomationForDispatcher,
  type ResolvedGitAuthor,
} from './automationView.js';
import { defaultAutomationConfig } from './criteria.js';

type Deps = ProjectAccessDeps & {
  readonly automation: AutomationRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Резолв идентичности владельца проекта для gitAuthorMode='owner' (иначе undefined —
// buildDispatcherView подставит null/null или значения из конфига).
async function resolveOwner(
  deps: Deps,
  ownerId: string,
  mode: AutomationForDispatcher['gitAuthorMode'],
): Promise<ResolvedGitAuthor | undefined> {
  if (mode !== 'owner') return undefined;
  const owner = await deps.users.getById(ownerId);
  return { name: owner?.displayName ?? null, email: owner?.email ?? null };
}

// Agent-side: диспетчер (ralph) тянет конфиг проекта. Только назначенный диспетчер
// проекта (requireDispatcherAccess) — иначе 403/404. Возвращает shouldRun + nextCriterion.
export class GetAutomationForDispatcher {
  constructor(private readonly deps: Deps) {}

  async execute(input: { projectId: string; userId: string }): Promise<AutomationForDispatcher> {
    const project = await requireDispatcherAccess(this.deps, input.projectId, input.userId);
    const config = await this.deps.automation.getConfig(input.projectId);
    const effective = config ?? defaultAutomationConfig(input.projectId);
    const owner = await resolveOwner(this.deps, project.ownerId, effective.gitAuthorMode);
    return buildDispatcherView(effective, this.deps.now(), owner);
  }
}
