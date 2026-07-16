import type {
  AutomationConfig,
  DeployMethod,
  GitAuthorMode,
  LimitKind,
} from '../../domain/automation/Automation.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
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
  readonly gitAuthorMode: GitAuthorMode;
  readonly gitAuthorName: string | null;
  readonly gitAuthorEmail: string | null;
  readonly ignoreClaudeMd: boolean;
  readonly ultracodeReviewEnabled: boolean;
  readonly deployMethod: DeployMethod;
  readonly deployCommand: string | null;
  readonly commitSyncEnabled: boolean;
  readonly commitSyncHour: number;
  readonly commitSyncMinute: number;
  readonly commitSyncThresholdHours: number;
  readonly assigneeDigestEnabled?: boolean;
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
    const access = await requireProjectAccess(
      this.deps,
      input.projectId,
      input.userId,
      'update_project',
    );

    const prev = await this.deps.automation.getConfig(input.projectId);
    const wasEnabled = prev?.enabled ?? false;

    // Публикация/деплой — owner-only при ИЗМЕНЕНИИ. Editor может править критерии/лимиты,
    // но не git-автора/игнор-CLAUDE.md/UltraCode/деплой (deployCommand = произвольный shell
    // на хосте диспетчера; owner-mode раскрывает email владельца). Сверяем с текущими
    // значениями (или дефолтами): если ничего из публикации не меняется — editor проходит.
    const baseline = prev ?? defaultAutomationConfig(input.projectId);
    const publishChanged =
      input.gitAuthorMode !== baseline.gitAuthorMode ||
      input.gitAuthorName !== baseline.gitAuthorName ||
      input.gitAuthorEmail !== baseline.gitAuthorEmail ||
      input.ignoreClaudeMd !== baseline.ignoreClaudeMd ||
      input.ultracodeReviewEnabled !== baseline.ultracodeReviewEnabled ||
      input.deployMethod !== baseline.deployMethod ||
      input.deployCommand !== baseline.deployCommand;
    if (publishChanged && !can(access.membership.role, 'set_publish_settings')) {
      throw new InsufficientProjectRoleError(access.membership.role, 'set_publish_settings');
    }

    await this.deps.automation.saveConfig(input.projectId, {
      enabled: input.enabled,
      limitKind: input.limitKind,
      limitCount: input.limitCount,
      limitMinutes: input.limitMinutes,
      pauseMinSeconds: input.pauseMinSeconds,
      pauseMaxSeconds: input.pauseMaxSeconds,
      ralphMode: input.ralphMode,
      gitAuthorMode: input.gitAuthorMode,
      gitAuthorName: input.gitAuthorName,
      gitAuthorEmail: input.gitAuthorEmail,
      ignoreClaudeMd: input.ignoreClaudeMd,
      ultracodeReviewEnabled: input.ultracodeReviewEnabled,
      deployMethod: input.deployMethod,
      deployCommand: input.deployCommand,
      commitSyncEnabled: input.commitSyncEnabled,
      commitSyncHour: input.commitSyncHour,
      commitSyncMinute: input.commitSyncMinute,
      commitSyncThresholdHours: input.commitSyncThresholdHours,
      assigneeDigestEnabled:
        input.assigneeDigestEnabled ?? baseline.assigneeDigestEnabled,
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
