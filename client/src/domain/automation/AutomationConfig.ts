// Конфиг автоматизации проекта (клиентская модель — зеркало серверного DTO).
// См. план virtual-exploring-pascal.md.

export type AutomationLimitKind = 'count' | 'time';

export type AutomationRunStatus = 'idle' | 'running' | 'completed' | 'stopped';

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
  // Прогресс (read-only из БД).
  readonly runStatus: AutomationRunStatus;
  readonly runStartedAt: string | null;
  readonly tasksCreated: number;
  readonly lastTaskAt: string | null;
  readonly criteria: ReadonlyArray<AutomationCriterion>;
};
