# Колонка «В РУЧНУЮ» — новый статус задачи `manual`

**Дата:** 2026-05-26
**Статус:** approved, готово к плану реализации

## Контекст

На канбан-доске сейчас три видимых колонки: ЧЕРНОВИКИ (`backlog`), ВОРКЕР
(`todo`), ГОТОВО (`done`). Статусы `in_progress` и `awaiting_clarification`
визуально живут внутри ВОРКЕРА с бейджами справа снизу.

ВОРКЕР — это очередь для Ralph / агента (карточки в `todo` пульсируют янтарным
«дыханием», там же висит кнопка «делегировать», auto-transition `todo →
in_progress` при первом коммите). Юзеру нужна **отдельная колонка для задач,
которые делает человек руками** — без авто-переходов в `in_progress`, без
индикации «жду агента».

## Цель

Добавить четвёртую видимую колонку **«В РУЧНУЮ»** между ЧЕРНОВИКИ и ВОРКЕР,
технически — новый доменный статус `manual`. Ничто из существующей автоматики
не должно срабатывать на этом статусе.

## Решения по поведению

| Аспект | Поведение |
| --- | --- |
| Что попадает в колонку | Задачи которые делает человек — парковка от агента. Drag из любых колонок ИЛИ создание через `+` на самой колонке. |
| Кнопка `+` на колонке | Открывает AddTaskDialog, создаёт со статусом `manual` (симметрично остальным колонкам). |
| QuickAddTodo (плавающий внизу) | Без изменений — продолжает создавать в `todo`. |
| TaskDrawerComposer (переключатель «Черновики/Воркеру») | Без изменений — остаётся 2-вариантным. Перенос в `manual` только drag'ом. |
| Стиль карточек в колонке | Нейтральный hover-border, как у `backlog` и `done`. Янтарного пульса нет — это не очередь к агенту. |
| Status-бэйдж в карточке | Не нужен — у `manual` своя колонка, как у `backlog`/`done`. |
| Quick-promote стрелка → | Только у `backlog`-колонки (как сейчас). У `manual` нет — drag'ом. |

## Список изменений по слоям

### 1. БД

Новая миграция [db/038_task_status_manual.sql](../../db):

```sql
ALTER TABLE tasks
  MODIFY COLUMN status ENUM('backlog','todo','in_progress','done','awaiting_clarification','manual')
  NOT NULL DEFAULT 'todo';
```

**Append-only** (как в [db/032_task_awaiting_clarification.sql](../../db/032_task_awaiting_clarification.sql)):
`'manual'` идёт в конец списка, существующие строки сохраняют свой numeric
storage order. DEFAULT не меняется.

### 2. Сервер

**[server/src/infrastructure/db/schema.ts](../../server/src/infrastructure/db/schema.ts)** — добавить `'manual'` в `mysqlEnum('status', [...])` для `tasks`.

**[server/src/domain/task/Task.ts](../../server/src/domain/task/Task.ts)** — расширить тип:

```ts
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'awaiting_clarification'
  | 'done'
  | 'manual';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
];
```

Комментарий: `manual` — отдельная ветка вне pipeline'а, для задач которые делает
человек. Не имеет авто-переходов.

**[server/src/presentation/tasks/schemas.ts](../../server/src/presentation/tasks/schemas.ts)** — добавить `'manual'` в `taskStatusSchema = z.enum([...])`.

### 3. MCP-сервер

**[mcp-server/src/api.ts](../../mcp-server/src/api.ts)** — расширить `TaskStatus` union типа.

**[mcp-server/src/index.ts](../../mcp-server/src/index.ts)** — добавить `'manual'` в `TASK_STATUS_VALUES`. В описаниях `pf_list_tasks`, `pf_move_task`, `pf_create_task` упомянуть `'manual'`:
- `pf_list_tasks`: пояснить что `'manual'` — это колонка для ручной работы человеком, без авто-переходов.
- `pf_move_task`: добавить `'manual'` в список валидных target'ов.
- `pf_create_task`: `'manual'` доступно явно, default остаётся `'todo'`.

### 4. Клиент

**[client/src/domain/task/Task.ts](../../client/src/domain/task/Task.ts)** — зеркально серверу: расширить `TaskStatus` и `TASK_STATUSES`.

**[client/src/presentation/components/tasks/statusLabels.ts](../../client/src/presentation/components/tasks/statusLabels.ts)**:

```ts
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'ЧЕРНОВИКИ',
  manual: 'В РУЧНУЮ',
  todo: 'ВОРКЕР',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};
```

`STATUS_SUBTITLE` для `manual` не задаём.

**[client/src/presentation/components/tasks/KanbanBoard.tsx](../../client/src/presentation/components/tasks/KanbanBoard.tsx)**:

```ts
const VISIBLE_STATUSES: readonly TaskStatus[] = ['backlog', 'manual', 'todo', 'done'];
```

В `groupByStatus` добавить bucket `manual: []`. Sort внутри `manual` — по `position`
(как у `backlog`/`todo`, не как у `done`). `toVisibleStatus` менять НЕ нужно
(manual → manual).

**[client/src/presentation/components/tasks/KanbanCard.tsx](../../client/src/presentation/components/tasks/KanbanCard.tsx)** — изменений нет. Условие `task.status === 'todo'` для янтарного пульса само по себе не сработает на `manual`. Кнопка делегирования рендерится только при `status === 'todo'` — тоже не сработает.

### 5. Что НЕ меняется (важно для регрессий)

| Файл / use-case | Почему не трогаем |
| --- | --- |
| [server/src/application/task/LinkCommit.ts](../../server/src/application/task/LinkCommit.ts) | Auto-transition `todo → in_progress` — фильтр `task.status === 'todo'`. На `manual` не сработает. |
| [server/src/application/task/SyncTaskCommits.ts](../../server/src/application/task/SyncTaskCommits.ts) | То же самое (другой call-site, та же логика). |
| [server/src/application/task/MaybeReopenForClarification.ts](../../server/src/application/task/MaybeReopenForClarification.ts) | Фильтр `task.status === 'awaiting_clarification'`. На `manual` не сработает. |
| [server/src/application/agent/ListMyDispatchedProjects.ts](../../server/src/application/agent/ListMyDispatchedProjects.ts) | Активные = `todo \| in_progress \| awaiting_clarification`. `manual` не попадёт в очередь у диспетчера агента — это правильно (задача не для агента). |
| [server/src/application/agent/EnqueueAgentJob.ts](../../server/src/application/agent/EnqueueAgentJob.ts) | Кнопка «делегировать» рендерится только при `status === 'todo'` в [KanbanCard.tsx](../../client/src/presentation/components/tasks/KanbanCard.tsx). На `manual` кнопки нет → запросить enqueue из UI невозможно. (Из MCP — можно, но это валидный явный выбор, не сломаем.) |
| [client/src/presentation/components/tasks/TaskDrawerComposer.tsx](../../client/src/presentation/components/tasks/TaskDrawerComposer.tsx) | Переключатель «Черновики/Воркеру» остаётся 2-вариантным (решение юзера). |
| [client/src/presentation/components/tasks/QuickAddTodo.tsx](../../client/src/presentation/components/tasks/QuickAddTodo.tsx) | Плавающий quick-add продолжает создавать в `todo`. |
| [client/src/presentation/components/tasks/TaskListView.tsx](../../client/src/presentation/components/tasks/TaskListView.tsx) | Tails по `backlog`/`todo` для футера TaskDrawer'а. `manual` композер не двигает — добавлять `manualTail` не нужно. Список в TaskListView рендерится по `position` и так покажет все задачи без фильтра. |

### 6. Drag-and-drop

Не требует изменений: `KanbanColumn` подписывает каждую колонку как droppable
по `data: { type: 'column', status }`, `KanbanBoard.handleDragEnd` берёт
`targetStatus` из `overData.status` или из карточки-цели через
`toVisibleStatus`. Для `manual` обе ветки работают «из коробки», т.к.:
- drop в пустую колонку manual: `overData.type === 'column'`, `overData.status === 'manual'` → `targetStatus = 'manual'`.
- drop на карточку в manual-колонке: `toVisibleStatus('manual') === 'manual'` → `targetStatus = 'manual'`.

`MoveTask` use-case ([server/src/application/task/MoveTask.ts](../../server/src/application/task/MoveTask.ts))
переписывать не нужно — `targetStatus: TaskStatus` уже принимает любой валидный
статус и считает midpoint position через `getPositionBounds(projectId, status)`,
который работает по индексу `idx_tasks_project_status_position` независимо от
конкретного значения статуса.

## Тестирование

После реализации проверить вручную (no automated tests в проекте, см. CLAUDE.md):

1. **Создание через `+`**: на колонке «В РУЧНУЮ» нажать `+`, ввести описание → задача
   появляется в колонке `manual`, ниже существующих.
2. **Drag из ЧЕРНОВИКОВ в «В РУЧНУЮ»**: карточка переезжает, position рассчитывается
   корректно, refresh страницы — порядок сохраняется.
3. **Drag из «В РУЧНУЮ» в ВОРКЕР**: карточка переезжает в `todo`, появляется
   янтарный пульс и кнопка «делегировать» — значит автоматика правильно
   подхватывает.
4. **Связать коммит [short-id] с задачей в `manual`**: задача НЕ должна перейти в
   `in_progress` автоматически. Останется в `manual`. Это подтверждает что
   `LinkCommit`-фильтр срабатывает корректно.
5. **MCP `pf_move_task` с `targetStatus: 'manual'`**: задача переезжает корректно.
6. **MCP `pf_create_task` с `status: 'manual'`**: задача создаётся в колонке `manual`.
7. **Старые задачи**: после миграции существующие задачи в прежних статусах
   остаются на своих местах (ENUM append-only, numeric storage order не меняется).

## Откат

Если потребуется откат: новая миграция уберёт `manual` из enum (`ALTER TABLE
... MODIFY COLUMN status ENUM(...без manual)`). MariaDB вернёт ошибку, если в
таблице есть строки с этим значением. Сначала придётся вручную перевести
такие строки в `backlog` или `todo`. На rollback заранее не закладываемся —
feature невелика, риск регрессий низкий.

## Out of scope

- Кастомизация колонок per-project (config-driven kanban). Сейчас все колонки
  захардкожены — это сохраняем.
- Переименование `manual` в локализации (русский label «В РУЧНУЮ» хардкодим
  в `STATUS_LABEL`).
- Авто-перевод в `manual` по каким-то условиям. Только явный action юзера.
- Уведомления / push на перевод в `manual`. Нет.
