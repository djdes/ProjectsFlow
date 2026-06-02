import type {
  AutomationConfig,
  AutomationRunStatus,
  DeployMethod,
  GitAuthorMode,
  LimitKind,
} from '../../domain/automation/Automation.js';

// Что сайт сохраняет при PUT конфига. criteria — полный набор переданных критериев
// (репозиторий делает upsert по ключу). Остальное — настройки прогона.
export type SaveAutomationInput = {
  readonly enabled: boolean;
  readonly limitKind: LimitKind;
  readonly limitCount: number | null;
  readonly limitMinutes: number | null;
  readonly pauseMinSeconds: number;
  readonly pauseMaxSeconds: number;
  readonly ralphMode: string;
  // Публикация/деплой (db/061).
  readonly gitAuthorMode: GitAuthorMode;
  readonly gitAuthorName: string | null;
  readonly gitAuthorEmail: string | null;
  readonly ignoreClaudeMd: boolean;
  readonly ultracodeReviewEnabled: boolean;
  readonly deployMethod: DeployMethod;
  readonly deployCommand: string | null;
  // run_status выставляется отдельно (resetRun/markStopped) — здесь не трогаем.
  readonly criteria: ReadonlyArray<{
    readonly key: string;
    readonly enabled: boolean;
    readonly systemPrompt: string;
    readonly userHint: string | null;
  }>;
};

// Снапшот run-state после record-task (для ответа диспетчеру).
export type AutomationRunState = {
  readonly runStatus: AutomationRunStatus;
  readonly runStartedAt: Date | null;
  readonly tasksCreated: number;
  readonly lastTaskAt: Date | null;
  readonly nextCriterionIdx: number;
};

export type AutomationRepository = {
  // Полный конфиг проекта (строка + критерии). null если строки project_automation нет.
  // Критерии возвращаются как есть из БД; мердж с дефолтами — на стороне use-case.
  getConfig(projectId: string): Promise<AutomationConfig | null>;

  // Upsert настроек + критериев. Создаёт строку project_automation при отсутствии.
  saveConfig(projectId: string, input: SaveAutomationInput): Promise<void>;

  // Сброс прогона: tasks_created=0, run_started_at=null, last_task_at=null,
  // next_criterion_idx=0, run_status=status. Используется при включении автоматизации.
  resetRun(projectId: string, status: AutomationRunStatus): Promise<void>;

  // Просто сменить run_status (напр. 'stopped' при выключении, 'completed' при лимите).
  setRunStatus(projectId: string, status: AutomationRunStatus): Promise<void>;

  // Атомарно отметить факт создания задачи: tasks_created++, run_started_at=COALESCE(...,NOW()),
  // last_task_at=NOW(), next_criterion_idx=nextIdx. Возвращает обновлённый run-state.
  recordTaskCreated(projectId: string, nextIdx: number): Promise<AutomationRunState>;

  // project_id'ы где автоматизация включена (enabled=true) — лёгкий флаг для discovery
  // в ListMyDispatchedProjects (диспетчер решает, какие проекты опрашивать полным GET'ом).
  listEnabledProjectIds(): Promise<ReadonlyArray<string>>;
};
