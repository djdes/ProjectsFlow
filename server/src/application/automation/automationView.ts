import type {
  AutomationConfig,
  AutomationRunStatus,
  LimitKind,
} from '../../domain/automation/Automation.js';
import { AUTOMATION_CRITERIA_BY_KEY, mergeCriteriaWithDefaults } from './criteria.js';

// Критерий, который диспетчер использует для генерации следующей задачи.
export type DispatcherCriterion = {
  readonly key: string;
  readonly label: string;
  readonly systemPrompt: string;
  readonly userHint: string | null;
};

// То, что отдаём диспетчеру (ralph) по GET /agent/projects/:id/automation и после
// record-task. shouldRun — готовый флаг «генерить ли ещё», лимит сервер считает сам.
export type AutomationForDispatcher = {
  readonly enabled: boolean;
  readonly shouldRun: boolean;
  readonly limitKind: LimitKind;
  readonly limitCount: number | null;
  readonly limitMinutes: number | null;
  readonly tasksCreated: number;
  readonly runStartedAt: Date | null;
  readonly runStatus: AutomationRunStatus;
  readonly pauseMinSeconds: number;
  readonly pauseMaxSeconds: number;
  readonly ralphMode: string;
  readonly nextCriterion: DispatcherCriterion | null;
};

// В пределах ли лимита прогон. count → tasks_created < limit_count; time → now < старт+минуты.
// null-лимит трактуем как «без ограничения» (один из двух всегда задан в UI).
export function isWithinLimit(config: AutomationConfig, now: Date): boolean {
  if (config.limitKind === 'count') {
    if (config.limitCount == null) return true;
    return config.tasksCreated < config.limitCount;
  }
  if (config.limitMinutes == null) return true;
  if (config.runStartedAt == null) return true; // ещё не стартовали — первая разрешена
  const deadline = config.runStartedAt.getTime() + config.limitMinutes * 60_000;
  return now.getTime() < deadline;
}

// Сборка ответа диспетчеру из конфига. nextCriterion выбирается round-robin по
// включённым критериям через next_criterion_idx.
export function buildDispatcherView(config: AutomationConfig, now: Date): AutomationForDispatcher {
  const merged = mergeCriteriaWithDefaults(config.criteria);
  const enabled = merged.filter((c) => c.enabled);
  const active =
    config.enabled && config.runStatus !== 'stopped' && config.runStatus !== 'completed';
  const shouldRun = active && enabled.length > 0 && isWithinLimit(config, now);

  let nextCriterion: DispatcherCriterion | null = null;
  if (enabled.length > 0) {
    const len = enabled.length;
    const idx = ((config.nextCriterionIdx % len) + len) % len;
    const c = enabled[idx]!;
    nextCriterion = {
      key: c.key,
      label: AUTOMATION_CRITERIA_BY_KEY.get(c.key)?.label ?? c.key,
      systemPrompt: c.systemPrompt,
      userHint: c.userHint,
    };
  }

  return {
    enabled: config.enabled,
    shouldRun,
    limitKind: config.limitKind,
    limitCount: config.limitCount,
    limitMinutes: config.limitMinutes,
    tasksCreated: config.tasksCreated,
    runStartedAt: config.runStartedAt,
    runStatus: config.runStatus,
    pauseMinSeconds: config.pauseMinSeconds,
    pauseMaxSeconds: config.pauseMaxSeconds,
    ralphMode: config.ralphMode,
    nextCriterion,
  };
}
