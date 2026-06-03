import { requireDispatcherAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { AutomationRepository } from './AutomationRepository.js';
import { buildDispatcherView, type AutomationForDispatcher } from './automationView.js';
import { defaultAutomationConfig } from './criteria.js';
import { resolveOwnerAuthor } from './resolveOwnerAuthor.js';

type Deps = ProjectAccessDeps & {
  readonly automation: AutomationRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Agent-side: диспетчер (ralph) тянет конфиг проекта. Только назначенный диспетчер
// проекта (requireDispatcherAccess) — иначе 403/404. Возвращает shouldRun + nextCriterion.
export class GetAutomationForDispatcher {
  constructor(private readonly deps: Deps) {}

  async execute(input: { projectId: string; userId: string }): Promise<AutomationForDispatcher> {
    const project = await requireDispatcherAccess(this.deps, input.projectId, input.userId);
    const config = await this.deps.automation.getConfig(input.projectId);
    const effective = config ?? defaultAutomationConfig(input.projectId);
    const owner = await resolveOwnerAuthor(this.deps.users, project.ownerId, effective.gitAuthorMode);
    return buildDispatcherView(effective, this.deps.now(), owner);
  }
}
