import type { AutomationConfig } from '../../domain/automation/Automation.js';
import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { AutomationRepository } from './AutomationRepository.js';
import { defaultAutomationConfig, mergeCriteriaWithDefaults } from './criteria.js';

type Deps = ProjectAccessDeps & {
  readonly automation: AutomationRepository;
};

// Site-side чтение конфига для диалога настроек. Возвращает все 5 критериев (с дефолтными
// промптами там, где юзер ещё не сохранял), а конфиг-уровень — из БД или дефолт.
export class GetAutomationConfig {
  constructor(private readonly deps: Deps) {}

  async execute(input: { projectId: string; userId: string }): Promise<AutomationConfig> {
    await requireProjectAccess(this.deps, input.projectId, input.userId, 'read_project');
    const saved = await this.deps.automation.getConfig(input.projectId);
    if (!saved) return defaultAutomationConfig(input.projectId);
    return { ...saved, criteria: mergeCriteriaWithDefaults(saved.criteria) };
  }
}
