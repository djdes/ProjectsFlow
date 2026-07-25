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
  // Ежедневная авто-обработка статусов задач по коммитам (db/072). 4 редактируемых поля;
  // commit_sync_last_run_on здесь НЕ трогаем — им владеет планировщик (markCommitSyncRun).
  readonly commitSyncEnabled: boolean;
  readonly commitSyncHour: number;
  readonly commitSyncMinute: number;
  readonly commitSyncDaysOfWeek: readonly number[];
  readonly commitSyncThresholdHours: number;
  readonly commitSyncAction: 'propose' | 'auto';
  readonly assigneeDigestEnabled: boolean;
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

  // Projects in a workspace that contribute tasks to the assignee digest.
  listAssigneeDigestProjectIds(workspaceId: string): Promise<ReadonlyArray<string>>;

  // --- Ежедневная авто-обработка статусов задач по коммитам (db/072) ---
  // Проекты с включённым commit-sync — для планировщика CommitSyncScheduler.
  // lastRunOn — МSK-дата ('YYYY-MM-DD') последнего прогона (анти-дубль), null если не было.
  listCommitSyncEnabled(): Promise<
    ReadonlyArray<{
      readonly projectId: string;
      readonly hour: number;
      readonly minute: number;
      // Дни недели (0..6). Пусто/NULL в БД нормализуется в «каждый день» здесь.
      readonly daysOfWeek: readonly number[];
      readonly lastRunOn: string | null;
    }>
  >;
  // Применить ОБЩЕЕ расписание сверки (время/дни/режим) ко ВСЕМ проектам пространства (db/141).
  // Enabled НЕ трогается: включённость проектов — пер-проектная, задаётся из чеклиста через
  // setCommitSyncEnabledProjects. Сбрасывает commit_sync_last_run_on (смена времени → пере-арм).
  // На вставку новой строки (у проекта не было автоматизации) enabled=false, чтобы расписание
  // не включало сверку молча. Возвращает число затронутых проектов.
  bulkSetCommitSyncSchedule(
    workspaceId: string,
    input: {
      readonly hour: number;
      readonly minute: number;
      readonly daysOfWeek: readonly number[];
      // Режим сверки: 'auto' — переносить задачи, 'propose' — только оповещать.
      readonly action: 'propose' | 'auto';
    },
  ): Promise<number>;
  // Проекты пространства (без «Входящих») с их пер-проектным флагом commit_sync_enabled
  // (left join project_automation, дефолт false при отсутствии строки). Для чеклиста в UI.
  listWorkspaceProjectsCommitSync(
    workspaceId: string,
  ): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly icon: string | null;
      readonly commitSyncEnabled: boolean;
    }>
  >;
  // Пер-проектная включённость сверки из чеклиста: для проектов из enabledProjectIds
  // commit_sync_enabled=true, для остальных проектов пространства — false (строка создаётся
  // при необходимости). У проектов, переходящих OFF→ON, сбрасывает commit_sync_last_run_on,
  // чтобы новосверяемый проект запустился на следующем тике. Возвращает число затронутых проектов.
  setCommitSyncEnabledProjects(
    workspaceId: string,
    enabledProjectIds: readonly string[],
  ): Promise<number>;
  // Пометить commit-sync прогон выполненным сегодня (МSK-дата 'YYYY-MM-DD').
  markCommitSyncRun(projectId: string, dateMsk: string): Promise<void>;

  // Гарантировать наличие строки настроек у проекта (insert-if-not-exists). Дефолты БД (db/101):
  // автоматизации ВКЛ. Вызывается при создании проекта — чтобы планировщики (commit-sync/EOD/
  // daily-plan) видели новый проект без ручной настройки.
  ensureDefaultRow(projectId: string): Promise<void>;

  // --- EOD-напоминание (db/101, Фаза 2) ---
  // Проекты с включённым eod_reminder — для EodReminderScheduler. lastRunOn — МSK-дата анти-дубля.
  listEodReminderEnabled(): Promise<
    ReadonlyArray<{
      readonly projectId: string;
      readonly hour: number;
      readonly minute: number;
      readonly lastRunOn: string | null;
    }>
  >;
  // Пометить EOD-прогон выполненным сегодня (МSK-дата 'YYYY-MM-DD').
  markEodReminderRun(projectId: string, dateMsk: string): Promise<void>;
};
