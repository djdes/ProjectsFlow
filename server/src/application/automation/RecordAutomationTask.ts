import type { AutomationConfig } from '../../domain/automation/Automation.js';
import { requireDispatcherAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { AutomationRepository } from './AutomationRepository.js';
import {
  buildDispatcherView,
  isWithinLimit,
  type AutomationForDispatcher,
} from './automationView.js';
import { defaultAutomationConfig, mergeCriteriaWithDefaults } from './criteria.js';
import { resolveOwnerAuthor } from './resolveOwnerAuthor.js';

type Deps = ProjectAccessDeps & {
  readonly automation: AutomationRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Agent-side: диспетчер сообщает, что создал очередную задачу автоматизации.
// Сервер инкрементит счётчик, стартует run на первой задаче, продвигает round-robin и
// фиксирует 'completed' при достижении лимита. Возвращает свежий вид для диспетчера.
export class RecordAutomationTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    projectId: string;
    userId: string;
    taskId: string;
  }): Promise<AutomationForDispatcher> {
    const project = await requireDispatcherAccess(this.deps, input.projectId, input.userId);

    const config = await this.deps.automation.getConfig(input.projectId);
    if (!config) {
      // Нет конфига — записывать нечего (диспетчер не должен был сюда дойти).
      return buildDispatcherView(defaultAutomationConfig(input.projectId), this.deps.now());
    }

    // Идентичность владельца нужна только при gitAuthorMode='owner' (иначе undefined).
    const owner = await resolveOwnerAuthor(this.deps.users, project.ownerId, config.gitAuthorMode);

    const merged = mergeCriteriaWithDefaults(config.criteria);
    const enabledCount = merged.filter((c) => c.enabled).length;
    const nextIdx = enabledCount > 0 ? (config.nextCriterionIdx + 1) % enabledCount : 0;

    const state = await this.deps.automation.recordTaskCreated(input.projectId, nextIdx);

    const updated: AutomationConfig = {
      ...config,
      runStatus: state.runStatus,
      runStartedAt: state.runStartedAt,
      tasksCreated: state.tasksCreated,
      lastTaskAt: state.lastTaskAt,
      nextCriterionIdx: state.nextCriterionIdx,
    };

    const now = this.deps.now();
    // Лимит достигнут после инкремента → закрываем прогон.
    if (updated.runStatus === 'running' && !isWithinLimit(updated, now)) {
      await this.deps.automation.setRunStatus(input.projectId, 'completed');
      return buildDispatcherView({ ...updated, runStatus: 'completed' }, now, owner);
    }
    return buildDispatcherView(updated, now, owner);
  }
}
