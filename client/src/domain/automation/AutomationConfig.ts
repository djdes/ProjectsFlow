// Конфиг автоматизации проекта (клиентская модель — зеркало серверного DTO).
// См. план virtual-exploring-pascal.md.

export type AutomationLimitKind = 'count' | 'time';

export type AutomationRunStatus = 'idle' | 'running' | 'completed' | 'stopped';

// От чьего имени воркер коммитит автоправки: фикс. бот / владелец / заданные вручную.
export type GitAuthorMode = 'bot' | 'owner' | 'custom';

// Как деплоить после успешной задачи: автодеплой GitHub / своя ssh-команда / никак.
export type DeployMethod = 'github_auto' | 'ssh_manual' | 'none';

export type AutomationCriterion = {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  // Редактируемый системный промпт для генерации задач этого критерия.
  readonly systemPrompt: string;
  // «Произвольное уточнение» юзера (что именно хочет).
  readonly userHint: string | null;
};

export type AutomationConfig = {
  readonly enabled: boolean;
  readonly limitKind: AutomationLimitKind;
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
  // Прогресс (read-only из БД).
  readonly runStatus: AutomationRunStatus;
  readonly runStartedAt: string | null;
  readonly tasksCreated: number;
  readonly lastTaskAt: string | null;
  readonly criteria: ReadonlyArray<AutomationCriterion>;
};
