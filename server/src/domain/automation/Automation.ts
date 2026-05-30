// Доменные типы автоматизации проекта. См. план virtual-exploring-pascal.md.
// Сайт хранит конфиг + редактируемые системные промпты, считает лимит и round-robin
// критериев; диспетчер (ralph) читает это и крутит цикл генерации/выполнения задач.

export type LimitKind = 'count' | 'time';

export type AutomationRunStatus = 'idle' | 'running' | 'completed' | 'stopped';

// Один критерий генерации задач. key — из фиксированного набора AUTOMATION_CRITERIA.
export type AutomationCriterion = {
  readonly key: string;
  readonly enabled: boolean;
  // Редактируемый системный промпт (по умолчанию — из AUTOMATION_CRITERIA).
  readonly systemPrompt: string;
  // «Произвольное уточнение» юзера: что именно хочет (напр. фичи лендинга: чат, фильтры).
  readonly userHint: string | null;
};

// Полный конфиг автоматизации проекта (строка project_automation + критерии).
export type AutomationConfig = {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly limitKind: LimitKind;
  readonly limitCount: number | null;
  readonly limitMinutes: number | null;
  readonly pauseMinSeconds: number;
  readonly pauseMaxSeconds: number;
  readonly ralphMode: string;
  readonly runStatus: AutomationRunStatus;
  readonly runStartedAt: Date | null;
  readonly tasksCreated: number;
  readonly lastTaskAt: Date | null;
  readonly nextCriterionIdx: number;
  readonly criteria: ReadonlyArray<AutomationCriterion>;
};
