// Фиксированный набор критериев автоматизации + дефолтные системные промпты.
// Промпты редактируемы в UI и хранятся per-project в project_automation_criteria;
// эти значения — сиды (показываются в диалоге, пока юзер не переписал) и fallback,
// если строки критерия в БД ещё нет.
//
// Каждый промпт инструктирует генератор (claude -p на стороне ralph) вернуть РОВНО
// одно продуманное описание задачи на русском, без преамбулы, любого объёма (крупные и
// сложные задачи допускаются), с учётом «уточнения» юзера. Порядок массива важен:
// round-robin идёт по нему.

import type { AutomationConfig, AutomationCriterion } from '../../domain/automation/Automation.js';

export type AutomationCriterionDef = {
  readonly key: string;
  readonly label: string;
  readonly defaultSystemPrompt: string;
};

const BASE_TAIL =
  'Учитывай «уточнение пользователя», если оно задано — оно приоритетнее общей темы. ' +
  'Не повторяй уже существующие задачи проекта. Верни ТОЛЬКО текст одной задачи: ' +
  '1–2 предложения сути, затем маркированный список конкретных шагов и критериев готовности. ' +
  'Без преамбулы вроде «Вот задача», без markdown-заголовков. Объём не ограничен — ' +
  'допускаются крупные и сложные задачи; описывай настолько подробно, насколько нужно для ' +
  'выполнения за один заход воркера.';

export const AUTOMATION_CRITERIA: ReadonlyArray<AutomationCriterionDef> = [
  {
    key: 'new_features',
    label: 'Новые фичи',
    defaultSystemPrompt:
      'Ты ставишь задачи на новые пользовательские фичи для проекта. Придумай ОДНУ ценную, ' +
      'законченную и реалистичную фичу, которая улучшает продукт для конечного пользователя. ' +
      'Фича может быть как небольшой, так и крупной/комплексной — приоритет на ценности для ' +
      'пользователя; дробить на под-шаги не нужно, воркер выполнит её целиком за один заход. ' +
      BASE_TAIL,
  },
  {
    key: 'design',
    label: 'Дизайн/вёрстка (со скриншотами)',
    defaultSystemPrompt:
      'Ты ставишь задачи на улучшение дизайна и вёрстки. Задача ОБЯЗАНА начинаться с осмотра ' +
      'текущего состояния экрана ПОДХОДЯЩИМ способом в зависимости от типа приложения: для ВЕБ — ' +
      'скриншот через браузер (Playwright); для ДЕСКТОПА/.exe (WinForms/.NET и т.п.) Playwright ' +
      'неприменим — собрать и запустить приложение и снять главное окно (скриншот окна). Затем найти ' +
      'конкретные визуальные проблемы (отступы, контраст, выравнивание, адаптив/размеры, состояния ' +
      'hover/focus или их аналог) и предложить точечные правки. Никакой переделки архитектуры — ' +
      'только вёрстка и стили. ' +
      BASE_TAIL,
  },
  {
    key: 'refactor',
    label: 'Рефакторинг бэка (с линтом)',
    defaultSystemPrompt:
      'Ты ставишь задачи на рефакторинг backend-кода без изменения поведения. Выбери участок ' +
      '(может быть и крупным: дублирование, длинная функция, слабая типизация, мёртвый код, ' +
      'разъезжающаяся абстракция) и опиши аккуратную правку. Задача ОБЯЗАНА включать прогон ' +
      'линтера и тестов и требование оставить их зелёными. Никаких изменений API и поведения — ' +
      'только чистота кода. ' +
      BASE_TAIL,
  },
  {
    key: 'security',
    label: 'Безопасность (без падения прода/БД)',
    defaultSystemPrompt:
      'Ты ставишь задачи на повышение безопасности. ЖЁСТКОЕ ограничение: ничего, что может ' +
      'уронить прод или стереть/мигрировать продовую базу данных. Только аддитивные и обратимые ' +
      'улучшения: валидация входных данных, проверка прав, заголовки безопасности, экранирование, ' +
      'аудит зависимостей. Задача ОБЯЗАНА содержать пункт перепроверки, что прод не падает и ' +
      'данные не теряются (никаких DROP/TRUNCATE/деструктивных миграций). ' +
      BASE_TAIL,
  },
  {
    key: 'performance',
    label: 'Производительность',
    defaultSystemPrompt:
      'Ты ставишь задачи на рост производительности: медленные запросы к БД, лишние ре-рендеры, ' +
      'размер бандла, N+1, отсутствие индексов/кэша. Выбери одно узкое место и опиши улучшение. ' +
      'Задача ОБЯЗАНА содержать способ замерить эффект «до/после» (метрика, время, размер). ' +
      BASE_TAIL,
  },
];

// Быстрый лукап ключ → определение.
export const AUTOMATION_CRITERIA_BY_KEY: ReadonlyMap<string, AutomationCriterionDef> = new Map(
  AUTOMATION_CRITERIA.map((c) => [c.key, c]),
);

// Мердж сохранённых критериев с фиксированным набором: возвращает все 5 в каноническом
// порядке, накладывая сохранённые значения. Отсутствующие → дефолт (enabled=false,
// дефолтный промпт). Пустой системный промпт в БД тоже заменяется дефолтом.
export function mergeCriteriaWithDefaults(
  saved: ReadonlyArray<AutomationCriterion>,
): AutomationCriterion[] {
  const byKey = new Map(saved.map((c) => [c.key, c]));
  return AUTOMATION_CRITERIA.map((def) => {
    const row = byKey.get(def.key);
    const prompt = row?.systemPrompt && row.systemPrompt.trim().length > 0
      ? row.systemPrompt
      : def.defaultSystemPrompt;
    return {
      key: def.key,
      enabled: row?.enabled ?? false,
      systemPrompt: prompt,
      userHint: row?.userHint ?? null,
    };
  });
}

// Конфиг по умолчанию, когда строки project_automation ещё нет (проект не настраивали).
export function defaultAutomationConfig(projectId: string): AutomationConfig {
  return {
    projectId,
    enabled: false,
    limitKind: 'count',
    limitCount: null,
    limitMinutes: null,
    pauseMinSeconds: 60,
    pauseMaxSeconds: 300,
    ralphMode: 'silent',
    runStatus: 'idle',
    runStartedAt: null,
    tasksCreated: 0,
    lastTaskAt: null,
    nextCriterionIdx: 0,
    criteria: mergeCriteriaWithDefaults([]),
  };
}
