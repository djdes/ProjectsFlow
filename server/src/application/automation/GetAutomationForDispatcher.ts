import { requireDispatcherAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { AutomationRepository } from './AutomationRepository.js';
import { buildDispatcherView, type AutomationForDispatcher } from './automationView.js';
import { defaultAutomationConfig } from './criteria.js';

type Deps = ProjectAccessDeps & {
  readonly automation: AutomationRepository;
  readonly now: () => Date;
};

// Agent-side: диспетчер (ralph) тянет конфиг проекта. Только назначенный диспетчер
// проекта (requireDispatcherAccess) — иначе 403/404. Возвращает shouldRun + nextCriterion.
export class GetAutomationForDispatcher {
  constructor(private readonly deps: Deps) {}

  async execute(input: { projectId: string; userId: string }): Promise<AutomationForDispatcher> {
    await requireDispatcherAccess(this.deps, input.projectId, input.userId);
    const config = await this.deps.automation.getConfig(input.projectId);
    const effective = config ?? defaultAutomationConfig(input.projectId);
    return buildDispatcherView(effective, this.deps.now());
  }
}
