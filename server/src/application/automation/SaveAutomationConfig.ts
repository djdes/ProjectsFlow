import type { AutomationConfig, LimitKind } from '../../domain/automation/Automation.js';
import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { AutomationRepository } from './AutomationRepository.js';
import { defaultAutomationConfig, mergeCriteriaWithDefaults } from './criteria.js';

type Deps = ProjectAccessDeps & {
  readonly automation: AutomationRepository;
};

export type SaveAutomationCommand = {
  readonly projectId: string;
  readonly userId: string;
  readonly enabled: boolean;
  readonly limitKind: LimitKind;
  readonly limitCount: number | null;
  readonly limitMinutes: number | null;
  readonly pauseMinSeconds: number;
  readonly pauseMaxSeconds: number;
  readonly ralphMode: string;
  readonly criteria: ReadonlyArray<{
    readonly key: string;
    readonly enabled: boolean;
    readonly systemPrompt: string;
    readonly userHint: string | null;
  }>;
};

// Site-side сохранение конфига (editor+). Логика run-state:
//  - включение из выключенного → сброс прогона (tasks_created=0, run_started_at=null,
//    run_status='running') — «начинаем заново от первой задачи».
//  - выключение → run_status='stopped'.
//  - изменение без смены enabled → run_status не трогаем.
export class SaveAutomationConfig {
  constructor(private readonly deps: Deps) {}

  async execute(input: SaveAutomationCommand): Promise<AutomationConfig> {
    await requireProjectAccess(this.deps, input.projectId, input.userId, 'update_project');

    const prev = await this.deps.automation.getConfig(input.projectId);
    const wasEnabled = prev?.enabled ?? false;

    await this.deps.automation.saveConfig(input.projectId, {
      enabled: input.enabled,
      limitKind: input.limitKind,
      limitCount: input.limitCount,
      limitMinutes: input.limitMinutes,
      pauseMinSeconds: input.pauseMinSeconds,
      pauseMaxSeconds: input.pauseMaxSeconds,
      ralphMode: input.ralphMode,
      criteria: input.criteria,
    });

    if (input.enabled && !wasEnabled) {
      await this.deps.automation.resetRun(input.projectId, 'running');
    } else if (!input.enabled && wasEnabled) {
      await this.deps.automation.setRunStatus(input.projectId, 'stopped');
    }

    const saved = await this.deps.automation.getConfig(input.projectId);
    if (!saved) return defaultAutomationConfig(input.projectId);
    return { ...saved, criteria: mergeCriteriaWithDefaults(saved.criteria) };
  }
}
