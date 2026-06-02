// Доменные типы автоматизации проекта. См. план virtual-exploring-pascal.md.
// Сайт хранит конфиг + редактируемые системные промпты, считает лимит и round-robin
// критериев; диспетчер (ralph) читает это и крутит цикл генерации/выполнения задач.

export type LimitKind = 'count' | 'time';

export type AutomationRunStatus = 'idle' | 'running' | 'completed' | 'stopped';

// От чьего имени воркер коммитит автоматические правки: фикс. бот / владелец проекта /
// заданные вручную имя+email.
export type GitAuthorMode = 'bot' | 'owner' | 'custom';

// Как деплоить после успешной задачи: рассчитываем на автодеплой GitHub (по push),
// своя ssh-команда (build+deploy вручную), либо не деплоить вовсе.
export type DeployMethod = 'github_auto' | 'ssh_manual' | 'none';

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
  // Публикация/деплой (db/061): применяются диспетчером к каждому прогону воркера.
  readonly gitAuthorMode: GitAuthorMode;
  readonly gitAuthorName: string | null;
  readonly gitAuthorEmail: string | null;
  readonly ignoreClaudeMd: boolean;
  readonly ultracodeReviewEnabled: boolean;
  readonly deployMethod: DeployMethod;
  readonly deployCommand: string | null;
  readonly runStatus: AutomationRunStatus;
  readonly runStartedAt: Date | null;
  readonly tasksCreated: number;
  readonly lastTaskAt: Date | null;
  readonly nextCriterionIdx: number;
  readonly criteria: ReadonlyArray<AutomationCriterion>;
};
