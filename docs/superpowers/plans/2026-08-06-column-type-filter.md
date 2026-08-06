# Фильтр колонки канбана по типу задачи — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У любой колонки доски проекта можно выбрать, что показывать: всё, только баги или только фичи.

**Architecture:** Чистое правило отбора в домене + личный хук на `localStorage` (по образцу `useDoneSortOrder`) + пункт в существующем меню колонки и бейдж в шапке. Фильтрация происходит в `KanbanBoard` перед передачей списка в колонку, поэтому счётчик в шапке становится верным сам собой. Серверных изменений нет.

**Tech Stack:** React 19 + TypeScript, Tailwind, node:test (`npm test -w @projectsflow/client`).

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-06-column-type-filter-design.md`.
- Пользовательские строки — на русском; код, типы, идентификаторы — на английском. Комментарии-пояснения «почему» на русском — норма этого репозитория.
- Слои клиента: `domain` ни от чего не зависит; `presentation` не импортирует из `infrastructure/http/*` напрямую.
- Серверные файлы и миграции НЕ трогать.
- Работать в worktree `C:\www\ProjectsFlow\.claude\worktrees\manual-tasks-batch`; `git add` только явными путями, никогда `git add -A`, никогда `git stash`.
- Команды гонять PowerShell-инструментом (bash на этом хосте подвисает): `npm run typecheck`, `npm run lint`, `npm test -w @projectsflow/client` из корня worktree.
- Предсуществующий warning линтера `react-hooks/exhaustive-deps` в `DashboardSections.tsx:634` — не наш, не чинить.

---

### Task 1: Правило отбора по типу

Чистая функция в домене: единственное место, где записано «задача без типа считается фичей».

**Files:**
- Modify: `client/src/domain/task/taskTypeMeta.ts`
- Test: `client/src/domain/task/taskTypeMeta.test.ts` (создать)

**Interfaces:**
- Consumes: тип `TaskType` из `client/src/domain/task/Task.ts` (`'feature' | 'bug'`); поле `Task.taskType: TaskType | null`.
- Produces: `export type ColumnTypeFilter = 'all' | 'bug' | 'feature'` и
  `export function matchesTypeFilter(taskType: TaskType | null | undefined, mode: ColumnTypeFilter): boolean` — используются в Task 2, 3, 4.
  Функция принимает ИМЕННО поле типа, а не задачу целиком: так её можно звать и из мест, где на руках только значение свойства.

- [ ] **Step 1: Написать падающий тест**

Создать `client/src/domain/task/taskTypeMeta.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTypeFilter } from './taskTypeMeta';

test('режим «всё» пропускает любую задачу', () => {
  assert.equal(matchesTypeFilter('bug', 'all'), true);
  assert.equal(matchesTypeFilter('feature', 'all'), true);
  assert.equal(matchesTypeFilter(null, 'all'), true);
});

test('режим «только баги» пропускает лишь явные баги', () => {
  assert.equal(matchesTypeFilter('bug', 'bug'), true);
  assert.equal(matchesTypeFilter('feature', 'bug'), false);
  assert.equal(matchesTypeFilter(null, 'bug'), false);
});

test('режим «только фичи» пропускает и задачи без типа', () => {
  // Поле появилось недавно: если бы null отсекался, режим прятал бы почти всю доску.
  assert.equal(matchesTypeFilter('feature', 'feature'), true);
  assert.equal(matchesTypeFilter(null, 'feature'), true);
  assert.equal(matchesTypeFilter(undefined, 'feature'), true);
  assert.equal(matchesTypeFilter('bug', 'feature'), false);
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npm test -w @projectsflow/client`
Expected: FAIL — `matchesTypeFilter is not a function` / ошибка импорта.

- [ ] **Step 3: Реализовать**

Дописать в конец `client/src/domain/task/taskTypeMeta.ts`:

```ts
// Режим показа колонки канбана по типу задачи. 'all' — колонка как раньше.
export type ColumnTypeFilter = 'all' | 'bug' | 'feature';

/**
 * Проходит ли задача фильтр колонки по типу.
 *
 * Задача без типа считается ФИЧЕЙ — та же логика, что у классификатора в compose-промпте
 * («при сомнениях — feature»). Поле типа появилось недавно, и у большинства задач оно
 * пустое: отсекай мы null, режим «только фичи» показывал бы почти пустую доску.
 */
export function matchesTypeFilter(
  taskType: TaskType | null | undefined,
  mode: ColumnTypeFilter,
): boolean {
  if (mode === 'all') return true;
  if (mode === 'bug') return taskType === 'bug';
  return taskType !== 'bug';
}
```

Импорт `TaskType` в файле уже есть (`import type { TaskType } from './Task';`).

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npm test -w @projectsflow/client`
Expected: PASS, три новых теста зелёные, старые не сломаны.

- [ ] **Step 5: Коммит**

```bash
git add client/src/domain/task/taskTypeMeta.ts client/src/domain/task/taskTypeMeta.test.ts
git commit -m "feat(board): правило отбора задач колонки по типу"
```

---

### Task 2: Хук личного фильтра колонок

Хранение выбора в `localStorage` — одна запись на проект.

**Files:**
- Create: `client/src/presentation/hooks/useColumnTypeFilter.ts`
- Read for reference: `client/src/presentation/hooks/useDoneSortOrder.ts` (образец такой же личной настройки)

**Interfaces:**
- Consumes: `ColumnTypeFilter` из Task 1 (`@/domain/task/taskTypeMeta`).
- Produces:
  ```ts
  export function useColumnTypeFilter(projectId: string): {
    filterFor: (status: string) => ColumnTypeFilter;
    setFilter: (status: string, mode: ColumnTypeFilter) => void;
  }
  ```
  Используется в Task 4.

- [ ] **Step 1: Реализовать хук**

Создать `client/src/presentation/hooks/useColumnTypeFilter.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { ColumnTypeFilter } from '@/domain/task/taskTypeMeta';

// Личный фильтр колонок по типу задачи. Хранится локально в браузере, как порядок
// сортировки «Готово» (useDoneSortOrder) — настройки доски в projects.kanban_settings
// общие на проект, и фильтр там скрыл бы карточки всей команде.
//
// Одна запись на проект (карта «статус колонки → режим»), а не ключ на колонку: карта
// читается и пишется целиком, и от удалённой кастомной колонки остаётся мусор максимум
// внутри одного значения.
const STORAGE_PREFIX = 'pf-column-type-filter:';

type FilterMap = Record<string, ColumnTypeFilter>;

function isMode(v: unknown): v is ColumnTypeFilter {
  return v === 'all' || v === 'bug' || v === 'feature';
}

function readInitial(projectId: string): FilterMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: FilterMap = {};
    for (const [status, mode] of Object.entries(parsed as Record<string, unknown>)) {
      if (isMode(mode) && mode !== 'all') out[status] = mode;
    }
    return out;
  } catch {
    // Испорченное значение (ручная правка, старый формат) не должно ронять доску.
    return {};
  }
}

export function useColumnTypeFilter(projectId: string): {
  filterFor: (status: string) => ColumnTypeFilter;
  setFilter: (status: string, mode: ColumnTypeFilter) => void;
} {
  const [filters, setFilters] = useState<FilterMap>(() => readInitial(projectId));

  // Переключение проекта: доска переиспользует компонент, поэтому карту перечитываем.
  useEffect(() => {
    setFilters(readInitial(projectId));
  }, [projectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(filters));
    } catch {
      // Переполненное/заблокированное хранилище не должно ломать работу с доской.
    }
  }, [filters, projectId]);

  const filterFor = useCallback(
    (status: string): ColumnTypeFilter => filters[status] ?? 'all',
    [filters],
  );

  const setFilter = useCallback((status: string, mode: ColumnTypeFilter): void => {
    setFilters((prev) => {
      // 'all' — состояние по умолчанию, в хранилище его не держим.
      if (mode === 'all') {
        if (!(status in prev)) return prev;
        const next = { ...prev };
        delete next[status];
        return next;
      }
      if (prev[status] === mode) return prev;
      return { ...prev, [status]: mode };
    });
  }, []);

  return { filterFor, setFilter };
}
```

- [ ] **Step 2: Проверить типы и линт**

Run: `npm run typecheck` затем `npm run lint`
Expected: без ошибок (кроме предсуществующего warning в `DashboardSections.tsx:634`).

- [ ] **Step 3: Коммит**

```bash
git add client/src/presentation/hooks/useColumnTypeFilter.ts
git commit -m "feat(board): личный фильтр колонок по типу в localStorage"
```

---

### Task 3: Пункт меню и бейдж в шапке колонки

Презентационная часть: меню умеет менять режим, шапка показывает включённый фильтр.
После этой задачи внешне ничего не меняется — пропы необязательные и их пока никто не передаёт.

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanColumnMenu.tsx`
- Modify: `client/src/presentation/components/tasks/KanbanColumn.tsx`

**Interfaces:**
- Consumes: `ColumnTypeFilter` и `TASK_TYPE_META` из `@/domain/task/taskTypeMeta`.
- Produces:
  - `KanbanColumnMenu` — новые необязательные пропы `typeFilter?: ColumnTypeFilter` и `onTypeFilter?: (mode: ColumnTypeFilter) => void`;
  - `KanbanColumn` — новый необязательный проп `headerBadge?: React.ReactNode`, который рендерится в шапке между названием и счётчиком.
  Оба используются в Task 4.

- [ ] **Step 1: Добавить секцию «Показывать» в меню колонки**

В `KanbanColumnMenu.tsx` дописать в тип пропсов (после `onSelect: () => void;`):

```ts
  // Фильтр колонки по типу задачи. undefined — секция «Показывать» не рендерится
  // (колонка, для которой фильтр не поддержан).
  typeFilter?: ColumnTypeFilter | undefined;
  onTypeFilter?: ((mode: ColumnTypeFilter) => void) | undefined;
```

Добавить `typeFilter`, `onTypeFilter` в деструктуризацию параметров.

Вставить секцию ПЕРЕД пунктом «Выделить» (то есть после блока выбора цвета и его
`<DropdownMenuSeparator />`):

```tsx
        {onTypeFilter && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              Показывать
            </DropdownMenuLabel>
            {(
              [
                { mode: 'all', label: 'Всё' },
                { mode: 'bug', label: 'Только баги' },
                { mode: 'feature', label: 'Только фичи' },
              ] as const
            ).map((option) => (
              <DropdownMenuItem
                key={option.mode}
                onClick={() => {
                  setOpen(false);
                  onTypeFilter(option.mode);
                }}
                className={cn('gap-2', (typeFilter ?? 'all') === option.mode && 'font-medium')}
              >
                <Check
                  className={cn(
                    'size-3.5',
                    (typeFilter ?? 'all') === option.mode ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {option.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
```

Добавить в импорт из `lucide-react` иконку `Check`; добавить импорт `cn` из `@/lib/utils`
и `type ColumnTypeFilter` из `@/domain/task/taskTypeMeta`, если их в файле ещё нет.

- [ ] **Step 2: Добавить слот бейджа в шапку колонки**

В `KanbanColumn.tsx` дописать в тип пропсов (рядом с `columnMenu`):

```ts
  // Бейдж состояния колонки (например включённый фильтр по типу). Рендерится в шапке
  // между названием и счётчиком. Содержимое и обработчики задаёт доска.
  headerBadge?: React.ReactNode;
```

Добавить `headerBadge` в деструктуризацию параметров.

В шапке вставить его прямо ПЕРЕД элементом счётчика — это `<span>` с классом
`shrink-0 px-0.5 text-xs tabular-nums text-muted-foreground/70`, содержащий `{tasks.length}`:

```tsx
              {headerBadge}
```

- [ ] **Step 3: Проверить типы и линт**

Run: `npm run typecheck` затем `npm run lint`
Expected: без ошибок (кроме предсуществующего warning в `DashboardSections.tsx:634`).

- [ ] **Step 4: Коммит**

```bash
git add client/src/presentation/components/tasks/KanbanColumnMenu.tsx client/src/presentation/components/tasks/KanbanColumn.tsx
git commit -m "feat(board): меню колонки умеет выбирать показ по типу задачи"
```

---

### Task 4: Подключить фильтр к доске

Доска связывает хук, правило отбора и презентационные части.

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanBoard.tsx`

**Interfaces:**
- Consumes: `useColumnTypeFilter` (Task 2), `matchesTypeFilter` + `TASK_TYPE_META` (Task 1), пропы `typeFilter`/`onTypeFilter`/`headerBadge` (Task 3).
- Produces: рабочая фича (терминальная задача).

- [ ] **Step 1: Подключить хук**

Рядом с вызовом `useDoneSortOrder` (ищи `const { order: doneOrder, toggle: toggleDoneOrder } = useDoneSortOrder();`) добавить:

```ts
  // Личный фильтр колонок по типу задачи (баги/фичи). Не общий: настройки доски
  // видит вся команда, а этот выбор — только тот, кто его сделал.
  const { filterFor: typeFilterFor, setFilter: setTypeFilter } = useColumnTypeFilter(projectId);
```

Добавить импорты:

```ts
import { useColumnTypeFilter } from '@/presentation/hooks/useColumnTypeFilter';
import { TASK_TYPE_META, matchesTypeFilter } from '@/domain/task/taskTypeMeta';
```

(`TASK_TYPE_META` в файле уже может быть импортирован — проверь, не дублируй.)

- [ ] **Step 2: Применить фильтр к списку задач колонки**

В рендере колонок (`shownStatuses.map((status) => {`) сейчас список передаётся так:

```tsx
                tasks={filterTasks(hideDone && status === 'done' ? [] : grouped[status])}
```

Заменить на вариант, который дополнительно отсекает по типу. Прямо перед `return` внутри
`shownStatuses.map` объяви:

```tsx
            const typeFilter = typeFilterFor(status);
            const columnTasks = filterTasks(
              hideDone && status === 'done' ? [] : grouped[status],
            ).filter((t) => matchesTypeFilter(t.taskType, typeFilter));
```

и передай `tasks={columnTasks}`.

Счётчик в шапке колонки рендерится из `tasks.length`, поэтому он станет верным сам собой —
отдельной правки не нужно.

- [ ] **Step 3: Передать пропы меню и бейдж**

В том же `map`, в существующий `<KanbanColumnMenu … />` добавить:

```tsx
                    typeFilter={typeFilter}
                    onTypeFilter={(mode) => setTypeFilter(status, mode)}
```

И передать в `<KanbanColumn … >` бейдж (только когда фильтр включён):

```tsx
                headerBadge={
                  typeFilter === 'all' ? undefined : (
                    <button
                      type="button"
                      onClick={() => setTypeFilter(status, 'all')}
                      title="Показаны не все задачи. Нажмите, чтобы снять фильтр"
                      className={cn(
                        'shrink-0 rounded px-1 py-px text-[10px] font-medium leading-4',
                        TASK_TYPE_META[typeFilter].badge,
                      )}
                    >
                      {TASK_TYPE_META[typeFilter].label}
                    </button>
                  )
                }
```

Бейдж обязателен: без него отфильтрованная колонка выглядит так, будто задачи пропали.

- [ ] **Step 4: Проверить типы, линт и тесты**

Run: `npm run typecheck`, затем `npm run lint`, затем `npm test -w @projectsflow/client`
Expected: без ошибок (кроме предсуществующего warning в `DashboardSections.tsx:634`); тесты зелёные.

- [ ] **Step 5: Коммит**

```bash
git add client/src/presentation/components/tasks/KanbanBoard.tsx
git commit -m "feat(board): колонка показывает только баги или только фичи"
```

---

### Task 5: Проверка на проде

Локальный full-stack прогон недоступен (миграция 054 ломает локальную БД) — проверяем после автодеплоя.

**Files:** изменений нет.

**Interfaces:**
- Consumes: задачи 1–4 в `main`.
- Produces: подтверждение работоспособности.

- [ ] **Step 1: Влить в main и дождаться деплоя**

```bash
git push github worktree-manual-tasks-batch:main
```

Дождаться появления короткого SHA в entry-бандле:

```bash
entry=$(curl -s https://projectsflow.ru/login | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://projectsflow.ru/assets/$entry" | grep -c "$(git rev-parse --short=7 HEAD)"
```

Expected: `1`.

- [ ] **Step 2: Проверить в браузере**

На доске проекта:

1. в меню «…» любой колонки выбрать «Только баги» — в колонке остаются задачи с типом «Баг», счётчик совпадает с числом карточек, в шапке появился бейдж «Баги»;
2. соседние колонки не изменились;
3. клик по бейджу возвращает колонку к «Всё»;
4. выбрать «Только фичи» — видны и задачи без типа (у большинства старых задач тип пустой);
5. перезагрузить страницу — режим колонки сохранился;
6. открыть тот же проект под другим аккаунтом — фильтра там нет (настройка личная).

- [ ] **Step 3: Зафиксировать результат**

Сообщить пользователю итог проверки. Если пункт 6 не выполняется — фильтр утёк в общее
состояние, вернуться к Task 2 (хранение должно быть только в `localStorage`).
