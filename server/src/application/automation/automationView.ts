import type {
  AutomationConfig,
  AutomationRunStatus,
  DeployMethod,
  GitAuthorMode,
  LimitKind,
} from '../../domain/automation/Automation.js';
import { AUTOMATION_CRITERIA_BY_KEY, mergeCriteriaWithDefaults } from './criteria.js';

// Резолвнутый git-автор для воркера. Для mode='owner' имя/email владельца резолвит
// use-case (у view нет доступа к UserRepository); для 'custom' — берутся из конфига;
// для 'bot' — оба null, воркер подставит фиксированный ProjectsFlow Agent.
export type ResolvedGitAuthor = {
  readonly name: string | null;
  readonly email: string | null;
};

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
  // Публикация/деплой (db/061). gitAuthorName/Email уже резолвнуты под mode:
  //  bot → null/null (воркер подставит фикс. ProjectsFlow Agent), owner → имя/email
  //  владельца, custom → заданные в конфиге.
  readonly gitAuthorMode: GitAuthorMode;
  readonly gitAuthorName: string | null;
  readonly gitAuthorEmail: string | null;
  readonly ignoreClaudeMd: boolean;
  readonly ultracodeReviewEnabled: boolean;
  readonly deployMethod: DeployMethod;
  readonly deployCommand: string | null;
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

// Резолв git-автора под mode. Для 'owner' имя/email приходят из use-case (резолв владельца);
// для 'custom' — из конфига; для 'bot' — null/null (воркер подставит фикс. идентичность).
function resolveGitAuthor(
  config: AutomationConfig,
  owner: ResolvedGitAuthor | undefined,
): ResolvedGitAuthor {
  if (config.gitAuthorMode === 'custom') {
    return { name: config.gitAuthorName, email: config.gitAuthorEmail };
  }
  if (config.gitAuthorMode === 'owner') {
    return { name: owner?.name ?? null, email: owner?.email ?? null };
  }
  return { name: null, email: null };
}

// Сборка ответа диспетчеру из конфига. nextCriterion выбирается round-robin по
// включённым критериям через next_criterion_idx. owner — резолвнутая идентичность
// владельца проекта (нужна только при gitAuthorMode='owner', иначе игнорируется).
export function buildDispatcherView(
  config: AutomationConfig,
  now: Date,
  owner?: ResolvedGitAuthor,
): AutomationForDispatcher {
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

  const author = resolveGitAuthor(config, owner);

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
    gitAuthorMode: config.gitAuthorMode,
    gitAuthorName: author.name,
    gitAuthorEmail: author.email,
    ignoreClaudeMd: config.ignoreClaudeMd,
    ultracodeReviewEnabled: config.ultracodeReviewEnabled,
    deployMethod: config.deployMethod,
    deployCommand: config.deployCommand,
    nextCriterion,
  };
}
