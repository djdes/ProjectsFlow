# Task Status `manual` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить новый доменный статус задачи `manual` и видимую колонку «В РУЧНУЮ» между ЧЕРНОВИКИ и ВОРКЕР на канбан-доске.

**Architecture:** Append-only ENUM в БД, симметричное расширение типа `TaskStatus` во всех слоях (server domain / zod / drizzle / MCP / client domain), новая видимая колонка в `KanbanBoard.VISIBLE_STATUSES`. Никаких авто-переходов на/из `manual`. Существующие фильтры по конкретным статусам (`todo`, `awaiting_clarification`) автоматически игнорируют `manual`.

**Tech Stack:** TypeScript, Express, mysql2/promise, Drizzle ORM, MariaDB, React, Vite, MCP SDK, zod.

**Spec:** [docs/superpowers/specs/2026-05-26-task-status-manual-design.md](../specs/2026-05-26-task-status-manual-design.md)

---

## File Map

**Create:**
- `db/038_task_status_manual.sql` — миграция ENUM (append-only).

**Modify:**
- `server/src/infrastructure/db/schema.ts:290-296` — добавить `'manual'` в `mysqlEnum`.
- `server/src/domain/task/Task.ts:5-13` — расширить `TaskStatus` и `TASK_STATUSES`.
- `server/src/presentation/tasks/schemas.ts:3-9` — добавить `'manual'` в zod-схему.
- `mcp-server/src/api.ts:63-68` — расширить `TaskStatus` union.
- `mcp-server/src/index.ts:64-70` — добавить `'manual'` в `TASK_STATUS_VALUES`. Описания tool'ов (`pf_list_tasks`, `pf_move_task`) — упомянуть `manual`.
- `client/src/domain/task/Task.ts:6-14` — зеркало серверу.
- `client/src/presentation/components/tasks/statusLabels.ts:5-11` — добавить `manual: 'В РУЧНУЮ'`.
- `client/src/presentation/components/tasks/KanbanBoard.tsx:41,73-97` — `VISIBLE_STATUSES` + `groupByStatus` bucket.

**No tests in this project** (см. CLAUDE.md: type-check + dev-server manual verify). Шаги верификации — через `npm run typecheck`, `npm run lint`, и ручной прогон сценариев из спеки в браузере.

---

## Task 1: Database migration

**Files:**
- Create: `db/038_task_status_manual.sql`

- [ ] **Step 1: Create migration file**

```sql
-- db/038_task_status_manual.sql
-- Новый статус задачи: 'manual' («В РУЧНУЮ») — колонка для задач, которые делает
-- человек руками. Отдельная ветка вне agent-pipeline'а: не триггерит auto-transition
-- todo→in_progress, не попадает в очередь диспетчера агента, не показывается с
-- янтарным «дыханием». Перевод сюда — только явный action юзера (drag или `+` на колонке).
--
-- Append-only (как db/032): 'manual' идёт в конец списка, чтобы существующие
-- строки сохранили numeric storage order MariaDB ENUM'а.

ALTER TABLE tasks
  MODIFY COLUMN status ENUM('backlog','todo','in_progress','done','awaiting_clarification','manual')
  NOT NULL DEFAULT 'todo';
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npm run db:migrate`
Expected: `→ 038_task_status_manual.sql ... applied`

- [ ] **Step 3: Sanity-check enum in DB**

Run (через mysql client с теми же кредами что migrator):
```sql
SHOW CREATE TABLE tasks\G
```
Expected: `status` column type содержит все 6 значений включая `'manual'`.

- [ ] **Step 4: Commit**

```bash
git add db/038_task_status_manual.sql
git commit -m "feat(db): миграция 038 — статус 'manual' для ручной колонки"
```

---

## Task 2: Server domain types

**Files:**
- Modify: `server/src/domain/task/Task.ts:1-13`

- [ ] **Step 1: Extend `TaskStatus` and `TASK_STATUSES`**

Заменить блок [server/src/domain/task/Task.ts:1-13](../../server/src/domain/task/Task.ts#L1-L13):

```ts
// 'awaiting_clarification' — активная работа на паузе до действия человека
// (ответ на ralph-question, разбор после maxAttempts retry, переформулировка задачи,
// auto-timeout F11). В пайплайне сидит между in_progress и done, поэтому в массиве
// тоже между ними — порядок определяет колонки канбана и фильтры.
//
// 'manual' — отдельная ветка ВНЕ pipeline'а: задачи которые делает человек руками.
// Не имеет авто-переходов; в array идёт в конец чтобы numeric storage order существующих
// строк MariaDB ENUM не менялся (см. db/038).
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

- [ ] **Step 2: Type-check server**

Run: `npm --workspace server run build` (или `npx tsc -p server/tsconfig.json --noEmit`)
Expected: PASS — error'ов нет (никто пока не делает exhaustive switch).

- [ ] **Step 3: Commit**

```bash
git add server/src/domain/task/Task.ts
git commit -m "feat(task): добавляем статус 'manual' в server domain"
```

---

## Task 3: Server zod schema

**Files:**
- Modify: `server/src/presentation/tasks/schemas.ts:3-9`

- [ ] **Step 1: Extend `taskStatusSchema`**

Заменить блок [server/src/presentation/tasks/schemas.ts:3-9](../../server/src/presentation/tasks/schemas.ts#L3-L9):

```ts
export const taskStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
]);
```

- [ ] **Step 2: Type-check**

Run: `npm --workspace server run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/presentation/tasks/schemas.ts
git commit -m "feat(task): zod-схема принимает status 'manual'"
```

---

## Task 4: Drizzle schema

**Files:**
- Modify: `server/src/infrastructure/db/schema.ts:290-296`

- [ ] **Step 1: Add `'manual'` to mysqlEnum**

Заменить блок [server/src/infrastructure/db/schema.ts:290-296](../../server/src/infrastructure/db/schema.ts#L290-L296):

```ts
    status: mysqlEnum('status', [
      'backlog',
      'todo',
      'in_progress',
      'awaiting_clarification',
      'done',
      'manual',
    ])
      .notNull()
      .default('todo'),
```

- [ ] **Step 2: Type-check**

Run: `npm --workspace server run build`
Expected: PASS.

- [ ] **Step 3: Smoke-test server boot**

Run: `npm run dev:server` (в отдельном терминале / background)
Expected: сервер стартует на :4317 без ошибок Drizzle / mysql2. Зайти `curl http://127.0.0.1:4317/health` (или эквивалент) — ответ 200. Завершить процесс после проверки.

- [ ] **Step 4: Commit**

```bash
git add server/src/infrastructure/db/schema.ts
git commit -m "feat(task): Drizzle-schema знает про status 'manual'"
```

---

## Task 5: MCP-server types and tool schemas

**Files:**
- Modify: `mcp-server/src/api.ts:61-68`
- Modify: `mcp-server/src/index.ts:62-70, 277-322`

- [ ] **Step 1: Extend `TaskStatus` in api.ts**

Заменить блок [mcp-server/src/api.ts:61-68](../../mcp-server/src/api.ts#L61-L68):

```ts
// 'awaiting_clarification' — задача на паузе до действия человека (ответ на
// ralph-question, разбор retry-fail). Между in_progress и done в пайплайне.
// 'manual' — отдельная ветка вне pipeline'а: колонка для задач, которые делает
// человек руками. Авто-переходов и agent-job триггеров не имеет.
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'awaiting_clarification'
  | 'done'
  | 'manual';
```

- [ ] **Step 2: Extend `TASK_STATUS_VALUES` in index.ts**

Заменить блок [mcp-server/src/index.ts:62-70](../../mcp-server/src/index.ts#L62-L70):

```ts
// 'awaiting_clarification' — задача на паузе до действия человека (Ralph F11 Q&A).
// 'manual' — колонка для задач, которые делает человек руками; вне pipeline'а агента.
// Порядок повторяет домен сервера.
const TASK_STATUS_VALUES = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
] as const;
```

- [ ] **Step 3: Update `pf_list_tasks` description**

Заменить description строкой (см. [mcp-server/src/index.ts:278-286](../../mcp-server/src/index.ts#L278-L286)):

```ts
    description:
      "List kanban tasks in a project. Returns id, title, description, status " +
      "('backlog' | 'todo' | 'in_progress' | 'awaiting_clarification' | 'done' | 'manual'), " +
      'position, commitCount, and commentCount ' +
      '(>0 means the task already has a discussion thread — read it via pf_get_task). \'backlog\' ' +
      'is the unnamed left-most column for raw triage items — users manually promote them ' +
      "to TODO. 'manual' is a parking column for tasks the user does by hand — no auto-transitions, " +
      "agent never picks them up. Use this BEFORE making a commit: read open tasks (todo + in_progress), " +
      'match against your staged diff and planned commit message, ask the user to confirm if you ' +
      'found a candidate, then call pf_link_commit_to_task and (optionally) pf_move_task after `git push`.',
```

- [ ] **Step 4: Update `pf_move_task` description and `targetStatus` schema**

Заменить блок description + properties для `pf_move_task` (см. [mcp-server/src/index.ts:298-317](../../mcp-server/src/index.ts#L298-L317)):

```ts
    description:
      'Move a task to a different status column. The task lands at the BOTTOM of the target ' +
      'column — the user can manually reorder in the UI later if needed. ' +
      'Use this to mark a task done after the commit is pushed, or to pull a task into in_progress ' +
      'when you start working on it. NOTE: pf_link_commit_to_task already auto-transitions ' +
      'todo→in_progress on the first linked commit, so you usually only need pf_move_task ' +
      "explicitly when moving to done (or back to todo for a revert). 'awaiting_clarification' " +
      'parks an in-progress task waiting on a human (answer to ralph-question, post-retry triage, ' +
      'reformulation) — server auto-returns it to in_progress when a comment with ' +
      '`<!-- ralph-answer ` or `<!-- ralph-grillme-summary ` marker arrives. ' +
      "'manual' is a parking column for tasks the user does by hand — no auto-transitions trigger " +
      'on this status.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (from pf_list_projects)' },
        taskId: { type: 'string', description: 'Task id (from pf_list_tasks)' },
        targetStatus: {
          type: 'string',
          enum: TASK_STATUS_VALUES,
          description:
            "Target column: 'backlog', 'todo', 'in_progress', 'awaiting_clarification', 'done', or 'manual'",
        },
      },
      required: ['projectId', 'taskId', 'targetStatus'],
      additionalProperties: false,
    },
```

- [ ] **Step 5: Type-check MCP-server**

Run: `npm --workspace mcp-server run build`
Expected: PASS — `TASK_STATUS_VALUES` уже завязан на `as const`, type-cross-check проходит.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/api.ts mcp-server/src/index.ts
git commit -m "feat(mcp): MCP-сервер знает про status 'manual'"
```

---

## Task 6: Client domain types

**Files:**
- Modify: `client/src/domain/task/Task.ts:1-14`

- [ ] **Step 1: Extend `TaskStatus` and `TASK_STATUSES`**

Заменить блок [client/src/domain/task/Task.ts:1-14](../../client/src/domain/task/Task.ts#L1-L14):

```ts
import type { AgentJob } from '../agentJob/AgentJob';

// 'awaiting_clarification' — активная задача на паузе до действия человека (ответ на
// ralph-question, разбор после maxAttempts retry, переформулировка). Между in_progress
// и done — порядок в массиве определяет колонки канбана.
//
// 'manual' — отдельная ветка ВНЕ pipeline'а: колонка для задач, которые делает человек
// руками. Не имеет авто-переходов. В array идёт в конец чтобы зеркалить ENUM (db/038).
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

- [ ] **Step 2: Type-check client**

Run: `npm --workspace client run typecheck`
Expected: PASS, **либо** error в `statusLabels.ts` про missing `manual` key в `Record<TaskStatus, string>` — это ожидается, фиксим в Task 7.

- [ ] **Step 3: Commit (defer to Task 7)**

⚠️ НЕ коммитим этот шаг отдельно — `STATUS_LABEL` ниже падает на missing key. Коммит будет в Task 7 вместе со `statusLabels.ts`.

---

## Task 7: Client status label

**Files:**
- Modify: `client/src/presentation/components/tasks/statusLabels.ts:1-17`

- [ ] **Step 1: Add `manual` label**

Заменить блок [client/src/presentation/components/tasks/statusLabels.ts:1-17](../../client/src/presentation/components/tasks/statusLabels.ts#L1-L17):

```ts
import type { TaskStatus } from '@/domain/task/Task';

// Visual-only label for kanban column header, status badge, in-card chip.
// The domain enum keeps `backlog/todo/...`; this is the user-facing rename.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'ЧЕРНОВИКИ',
  manual: 'В РУЧНУЮ',
  todo: 'ВОРКЕР',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};

// Optional small subtitle rendered under the main label in column header.
// Currently only for `todo` (ВОРКЕР · Claude Opus). null/undefined = no subtitle.
export const STATUS_SUBTITLE: Partial<Record<TaskStatus, string>> = {
  todo: 'Claude Opus',
};
```

- [ ] **Step 2: Type-check client**

Run: `npm --workspace client run typecheck`
Expected: PASS — все `Record<TaskStatus, string>` ключи присутствуют.

- [ ] **Step 3: Commit (вместе с Task 6)**

```bash
git add client/src/domain/task/Task.ts client/src/presentation/components/tasks/statusLabels.ts
git commit -m "feat(client): client domain + STATUS_LABEL для статуса 'manual'"
```

---

## Task 8: Kanban board — visible column

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanBoard.tsx:38-47,73-97`

- [ ] **Step 1: Update `VISIBLE_STATUSES` and `toVisibleStatus`**

Заменить блок [client/src/presentation/components/tasks/KanbanBoard.tsx:38-47](../../client/src/presentation/components/tasks/KanbanBoard.tsx#L38-L47):

```ts
// Какие колонки реально рисуем. in_progress и awaiting_clarification не имеют
// собственных колонок — задачи в этих статусах визуально живут в TODO с badge'ом
// статуса справа снизу. См. KanbanCard. 'manual' — собственная колонка между
// backlog и todo: парковка для задач, которые делает человек руками.
const VISIBLE_STATUSES: readonly TaskStatus[] = ['backlog', 'manual', 'todo', 'done'];

// Маппинг реального статуса в визуальную колонку.
function toVisibleStatus(status: TaskStatus): TaskStatus {
  if (status === 'in_progress' || status === 'awaiting_clarification') return 'todo';
  return status;
}
```

- [ ] **Step 2: Add `manual` bucket to `groupByStatus`**

Заменить блок [client/src/presentation/components/tasks/KanbanBoard.tsx:73-97](../../client/src/presentation/components/tasks/KanbanBoard.tsx#L73-L97):

```ts
function groupByStatus(tasks: Task[], doneOrder: DoneSortOrder): Record<TaskStatus, Task[]> {
  // Группируем по визуальной колонке: in_progress / awaiting_clarification визуально
  // лежат в TODO (статус на task'е сохраняется и отображается badge'ом справа снизу).
  const out: Record<TaskStatus, Task[]> = {
    backlog: [],
    manual: [],
    todo: [],
    in_progress: [],
    awaiting_clarification: [],
    done: [],
  };
  for (const t of tasks) out[toVisibleStatus(t.status)].push(t);
  for (const s of TASK_STATUSES) {
    if (s === 'done') {
      // Готовые сортируем по времени завершения (updatedAt), а не по position:
      // перенос в done обновляет updatedAt, поэтому свежевыполненная задача сама
      // встаёт наверх при 'newest'. Это развязывает порядок done с position и не
      // конфликтует с drag-математикой (она привязана к position в остальных колонках).
      const dir = doneOrder === 'newest' ? -1 : 1;
      out[s].sort((a, b) => dir * (a.updatedAt.getTime() - b.updatedAt.getTime()));
    } else {
      out[s].sort((a, b) => a.position - b.position);
    }
  }
  return out;
}
```

- [ ] **Step 3: Type-check + lint client**

Run: `npm --workspace client run typecheck && npm --workspace client run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/presentation/components/tasks/KanbanBoard.tsx
git commit -m "feat(tasks): новая видимая колонка «В РУЧНУЮ» в KanbanBoard"
```

---

## Task 9: End-to-end manual verification

**Files:** none (browser testing).

⚠️ В проекте нет автоматизированных тестов (см. CLAUDE.md). Эта таска — обязательный manual-smoke, без неё PR не закрываем.

- [ ] **Step 1: Start dev environment**

Run: `npm run dev`
Expected: client на `http://127.0.0.1:5173`, server на :4317 — оба без ошибок.

- [ ] **Step 2: Visual sanity-check колонки**

Открыть любой проект (например ScanFlow) в браузере. На доске должно быть 4 колонки слева-направо: `ЧЕРНОВИКИ` → `В РУЧНУЮ` → `ВОРКЕР` → `ГОТОВО`. Колонка «В РУЧНУЮ» — пустая, без подзаголовка, с обычной кнопкой `+`.

- [ ] **Step 3: Create через `+`**

Нажать `+` на колонке «В РУЧНУЮ» → ввести описание «test-manual-1» → создать.
Expected: задача появляется в колонке `manual` внизу. Refresh страницы — задача всё ещё там.

- [ ] **Step 4: Drag из ЧЕРНОВИКОВ в «В РУЧНУЮ»**

Создать задачу в ЧЕРНОВИКАХ → drag в колонку «В РУЧНУЮ».
Expected: переезжает, position рассчитывается, refresh сохраняет позицию.

- [ ] **Step 5: Drag из «В РУЧНУЮ» в ВОРКЕР**

Карточку из «В РУЧНУЮ» drag в ВОРКЕР.
Expected: попадает в `todo`, появляется янтарный пульс и кнопка «делегировать».

- [ ] **Step 6: Связка коммита — авто-переход НЕ срабатывает**

Создать задачу в «В РУЧНУЮ» с описанием. Записать её `[short-id]`. Закоммитить (любой файл) с сообщением `chore: dummy [short-id]`. Сделать `git push`. Через UI / MCP вызвать `pf_link_commit_to_task`.
Expected: коммит привязан (счётчик коммитов на карточке ≥1), но **статус остался `manual`** — задача НЕ ушла в `in_progress`. Это критическая проверка фильтра в [server/src/application/task/LinkCommit.ts:91](../../server/src/application/task/LinkCommit.ts#L91).

- [ ] **Step 7: MCP `pf_move_task` с `manual`**

Из MCP-клиента (например Claude Code в этом проекте): `pf_move_task` с `targetStatus: 'manual'`.
Expected: задача переезжает в колонку «В РУЧНУЮ» без ошибок zod / БД.

- [ ] **Step 8: MCP `pf_create_task` с `status: 'manual'`**

`pf_create_task` с `status: 'manual'`.
Expected: задача создаётся в колонке «В РУЧНУЮ».

- [ ] **Step 9: Старые задачи на своих местах**

Открыть проект где есть задачи в `todo`/`in_progress`/`done` — все они должны быть на прежних местах (ENUM append-only не должна была их сдвинуть).

- [ ] **Step 10: Финальный коммит / cleanup**

Если по ходу всех шагов скопились dummy-задачи — удалить их через UI (правая корзина на карточке). Никаких новых файлов в репо не должно остаться.

```bash
git status
```
Expected: `working tree clean` (всё уже закоммичено в Tasks 1-8).

---

## Self-Review Notes

**Spec coverage:**
- ✓ БД миграция (Task 1) → спека §1
- ✓ Server domain + zod + drizzle (Tasks 2-4) → спека §2
- ✓ MCP (Task 5) → спека §3
- ✓ Client domain + label + KanbanBoard (Tasks 6-8) → спека §4
- ✓ Регрессионные проверки автоматики (Task 9 шаг 6) → спека §5
- ✓ Drag-and-drop работает «из коробки» — verified в Task 9 шаги 4-5 → спека §6
- ✓ Manual smoke сценарии → спека §«Тестирование»

**Type consistency:** `TaskStatus` union одинаков в server-domain, zod, drizzle, MCP api, MCP index `TASK_STATUS_VALUES`, client-domain. `STATUS_LABEL.manual` ключ покрывает добавленный union-член.

**No placeholders:** все шаги содержат конкретный код, файлы с line-numbers, команды и expected output.
