# Inbox: чекбокс выполнения + делегирование — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Шаги отмечены чекбоксами (`- [ ]`).

**Goal:** добавить во «Входящие» чекбокс «выполнено» + скрытие выполненных, и one-to-one делегирование inbox-задачи участникам моих shared-проектов с in-app+email accept/decline flow.

**Архитектура:** Phase A — UI-only на клиенте. Phase B — полный full-stack: миграция БД + Drizzle schema + use-cases + HTTP routes + email-шаблоны + клиентский HTTP-адаптер + новые UI компоненты. Visibility делегированных задач — через ассоциацию (`task_delegations`-таблица), один источник истины для `status`.

**Tech stack:** Express 4 + Drizzle + MariaDB на сервере; React 19 + Vite + Tailwind + shadcn на фронте; SmtpEmailSender + NotificationHub (SSE) для уведомлений.

**Базовый спек:** [docs/superpowers/specs/2026-05-27-inbox-checkbox-and-delegation-design.md](../specs/2026-05-27-inbox-checkbox-and-delegation-design.md).

**Верификация после каждого этапа:**
- `npm run typecheck` (zero TS errors)
- `npm run lint` (zero ESLint errors — особенно `boundaries` правила)
- В конце: dev-сервер + ручной smoke (нет автотестов в репо).

**Соглашения по коммитам:** один task = один коммит. Format: `feat(inbox): ...` для feature-коммитов, `feat(db): ...` для миграций, `feat(server): ...` для backend-only.

---

## Phase A — Чекбокс + Hide Done (UI-only)

### Task A1: InboxCheckbox component + интеграция в TaskListRow и KanbanCard

**Files:**
- Create: `client/src/presentation/components/tasks/InboxCheckbox.tsx`
- Modify: `client/src/presentation/components/tasks/TaskListView.tsx` (TaskListRow, ~line 192)
- Modify: `client/src/presentation/components/tasks/KanbanCard.tsx`

- [ ] **Step 1:** Создать `client/src/presentation/components/tasks/InboxCheckbox.tsx`:

```tsx
import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  task: Task;
  // Последняя задача в целевой колонке для расчёта position при move.
  // Done → afterTaskId = последняя done; Todo → afterTaskId = последняя todo.
  // Если в колонке пусто — null (use-case рассчитает position от bounds).
  lastDoneTaskId: string | null;
  lastTodoTaskId: string | null;
  onChanged?: () => void;
};

// Круглый чекбокс слева в строке inbox-задачи. Optimistic UI — тиково зачёркивает
// сразу, под капотом move в done/todo. Возврат всегда в todo (предыдущий статус не
// помним; в inbox статусы кроме todo/done почти не используются).
export function InboxCheckbox({ task, lastDoneTaskId, lastTodoTaskId, onChanged }: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  const isDone = optimistic ?? task.status === 'done';

  const toggle = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (pending) return;
    const next = !isDone;
    setOptimistic(next);
    setPending(true);
    try {
      const targetStatus = next ? 'done' : 'todo';
      const afterTaskId = next ? lastDoneTaskId : lastTodoTaskId;
      await taskRepository.move(task.projectId, task.id, {
        targetStatus,
        beforeTaskId: null,
        afterTaskId,
      });
      onChanged?.();
    } catch (err) {
      setOptimistic(null);
      toast.error(`Не удалось: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={isDone ? 'Снять отметку' : 'Отметить выполненным'}
      aria-pressed={isDone}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
        isDone
          ? 'border-emerald-500 bg-emerald-500 text-white'
          : 'border-muted-foreground/40 hover:border-emerald-500',
        pending && 'opacity-60',
      )}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : isDone ? (
        <Check className="size-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}
```

- [ ] **Step 2:** В `TaskListView.tsx` — добавить рендер InboxCheckbox **только** для inbox-задач (где `showShortId` = false означает inbox). Найти `TaskListRow` (~line 192) и обновить:
  - Передать `showCheckbox: boolean` в `TaskListRow` (true когда `showCommits === false`, т.е. inbox).
  - В компоненте TaskListRow: если `showCheckbox && !task.delegatedToAgent` — рендерить `<InboxCheckbox>` слева перед текстом.
  - Прокинуть `lastDoneTaskId` и `lastTodoTaskId`, вычисленные в parent (`TaskListView`) аналогично `backlogTail`/`todoTail`.

  В `TaskListView` добавить рядом с `backlogTail`/`todoTail`:
  ```tsx
  const doneList = tasks.filter((t) => t.status === 'done').sort(sortByPos);
  const lastDoneTaskId = doneList[doneList.length - 1]?.id ?? null;
  const lastTodoTaskId = todoTail?.id ?? null;
  ```
  И передавать в `TaskListRow`:
  ```tsx
  <TaskListRow
    ...
    showCheckbox={!showCommits}
    lastDoneTaskId={lastDoneTaskId}
    lastTodoTaskId={lastTodoTaskId}
    onChanged={() => void refetch()}
  />
  ```

  В TaskListRow добавить props и рендер чекбокса:
  ```tsx
  function TaskListRow({
    task, showShortId, showCheckbox, lastDoneTaskId, lastTodoTaskId, onEdit, onDelete, onChanged,
  }: {
    task: Task; showShortId: boolean; showCheckbox: boolean;
    lastDoneTaskId: string | null; lastTodoTaskId: string | null;
    onEdit: () => void; onDelete: () => void; onChanged: () => void;
  }) {
    // ...
    return (
      <li className="..." onClick={onEdit}>
        {showCheckbox && !task.delegatedToAgent && (
          <InboxCheckbox task={task} lastDoneTaskId={lastDoneTaskId} lastTodoTaskId={lastTodoTaskId} onChanged={onChanged} />
        )}
        <div className="min-w-0 flex-1">...</div>
        ...
      </li>
    );
  }
  ```

- [ ] **Step 3:** В `KanbanCard.tsx` — добавить аналогично. Открыть файл, найти render task card, добавить в начало карточки (если `props.showCheckbox`) рендер `<InboxCheckbox>`. Проп `showCheckbox` пробрасывается из KanbanColumn → KanbanBoard (true когда `showCommits === false`).

- [ ] **Step 4:** Verify

```bash
npm run typecheck
npm run lint
```
Expected: zero errors.

- [ ] **Step 5:** Commit

```bash
git add client/src/presentation/components/tasks/InboxCheckbox.tsx \
        client/src/presentation/components/tasks/TaskListView.tsx \
        client/src/presentation/components/tasks/KanbanCard.tsx \
        client/src/presentation/components/tasks/KanbanColumn.tsx \
        client/src/presentation/components/tasks/KanbanBoard.tsx
git commit -m "feat(inbox): чекбокс выполнения в строке inbox-задачи"
```

---

### Task A2: HideDoneToggle в шапке Inbox + фильтр в List/Kanban

**Files:**
- Modify: `client/src/presentation/pages/InboxPage.tsx`
- Modify: `client/src/presentation/components/tasks/TaskListView.tsx`
- Modify: `client/src/presentation/components/tasks/KanbanBoard.tsx`

- [ ] **Step 1:** В `InboxPage.tsx`:
  - Добавить state `hideDone` + localStorage persistence по ключу `inbox.hide-done`.
  - Добавить компонент `HideDoneToggle` рядом с `ViewToggle` в header'е (right side).
  - Передавать prop `hideDone` в KanbanBoard и TaskListView.

  ```tsx
  const HIDE_DONE_KEY = 'inbox.hide-done';
  function loadHideDone(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(HIDE_DONE_KEY) === '1';
  }
  // ... в InboxPage:
  const [hideDone, setHideDone] = useState<boolean>(loadHideDone);
  const handleHideDoneChange = (v: boolean): void => {
    setHideDone(v);
    try { window.localStorage.setItem(HIDE_DONE_KEY, v ? '1' : '0'); } catch {}
  };
  ```

  Рядом с ViewToggle:
  ```tsx
  <div className="flex items-center gap-2">
    <HideDoneToggle value={hideDone} onChange={handleHideDoneChange} />
    <ViewToggle value={view} onChange={handleViewChange} />
  </div>
  ```

  Компонент `HideDoneToggle`:
  ```tsx
  import { Eye, EyeOff } from 'lucide-react';

  function HideDoneToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs transition-colors',
          value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={value}
        title={value ? 'Показать выполненные' : 'Скрыть выполненные'}
      >
        {value ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        {value ? 'Скрыты выполненные' : 'Скрыть выполненные'}
      </button>
    );
  }
  ```

  Передать в дочерние:
  ```tsx
  <KanbanBoard projectId={project.id} showCommits={false} hideDone={hideDone} />
  // и
  <TaskListView projectId={project.id} showCommits={false} hideDone={hideDone} />
  ```

- [ ] **Step 2:** В `TaskListView.tsx` — принять prop `hideDone`, применить фильтр перед сортировкой:
  ```tsx
  type Props = { projectId: string; showCommits?: boolean; hideDone?: boolean };
  // ...
  const filtered = hideDone ? tasks.filter((t) => t.status !== 'done') : tasks;
  const sorted = [...filtered].sort(/* ... */);
  ```

- [ ] **Step 3:** В `KanbanBoard.tsx` — принять prop `hideDone`. Применить фильтр к задачам перед группировкой по колонкам (done-колонка останется пустой, но сама колонка отображается).

- [ ] **Step 4:** Verify

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5:** Commit

```bash
git add client/src/presentation/pages/InboxPage.tsx \
        client/src/presentation/components/tasks/TaskListView.tsx \
        client/src/presentation/components/tasks/KanbanBoard.tsx
git commit -m "feat(inbox): toggle «скрыть выполненные» в шапке"
```

---

## Phase B — Делегирование

### Task B1: миграция БД + Drizzle schema

**Files:**
- Create: `db/039_task_delegations.sql`
- Modify: `server/src/infrastructure/db/schema.ts`

- [ ] **Step 1:** Создать `db/039_task_delegations.sql`:

```sql
-- 039: делегирование inbox-задач. One-to-one — одна активная (pending|accepted)
-- делегация на задачу; архивные/declined остаются как история (no DELETE).
-- См. spec docs/superpowers/specs/2026-05-27-inbox-checkbox-and-delegation-design.md.

CREATE TABLE IF NOT EXISTS task_delegations (
  id               CHAR(36)    NOT NULL,
  task_id          CHAR(36)    NOT NULL,
  delegate_user_id CHAR(36)    NOT NULL,
  status           ENUM('pending','accepted','declined','withdrawn','archived')
                   NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at     TIMESTAMP   NULL,
  PRIMARY KEY (id),
  KEY idx_task_status (task_id, status),
  KEY idx_delegate_status (delegate_user_id, status),
  CONSTRAINT fk_td_task FOREIGN KEY (task_id)
    REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_td_user FOREIGN KEY (delegate_user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2:** Прочитать `server/src/infrastructure/db/schema.ts` чтобы понять паттерн drizzle-определений (mariadb-core mysqlTable). Добавить:

```ts
// task_delegations — миграция db/039
export const taskDelegations = mysqlTable('task_delegations', {
  id: char('id', { length: 36 }).primaryKey(),
  taskId: char('task_id', { length: 36 }).notNull(),
  delegateUserId: char('delegate_user_id', { length: 36 }).notNull(),
  status: mysqlEnum('status', ['pending', 'accepted', 'declined', 'withdrawn', 'archived'])
    .notNull()
    .default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  respondedAt: timestamp('responded_at'),
}, (t) => ({
  byTaskStatus: index('idx_task_status').on(t.taskId, t.status),
  byDelegateStatus: index('idx_delegate_status').on(t.delegateUserId, t.status),
}));
```

(Точные имена импортов — `char`, `mysqlEnum`, `timestamp`, `index`, `mysqlTable` — взять из других таблиц этого файла, паттерн должен быть.)

- [ ] **Step 3:** Прогнать миграцию локально:

```bash
npm run db:migrate
```
Expected: «Migrating 039_task_delegations.sql... OK»

- [ ] **Step 4:** Verify

```bash
npm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add db/039_task_delegations.sql server/src/infrastructure/db/schema.ts
git commit -m "feat(db): миграция task_delegations (one-to-one делегирование inbox-задач)"
```

---

### Task B2: domain `TaskDelegation` (server + client)

**Files:**
- Create: `server/src/domain/task/TaskDelegation.ts`
- Create: `client/src/domain/task/TaskDelegation.ts`

- [ ] **Step 1:** Создать `server/src/domain/task/TaskDelegation.ts`:

```ts
// Mirrors client/src/domain/task/TaskDelegation.ts.
// Делегирование одной inbox-задачи одному пользователю. См. db/039.

export type TaskDelegationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'archived';

export const TASK_DELEGATION_STATUSES: readonly TaskDelegationStatus[] = [
  'pending',
  'accepted',
  'declined',
  'withdrawn',
  'archived',
];

// Активные = занимают слот «одна делегация на задачу». pending — ждёт ответа,
// accepted — делегат принял и работает. Остальные — терминальные/исторические.
export const ACTIVE_DELEGATION_STATUSES: readonly TaskDelegationStatus[] = ['pending', 'accepted'];

export type TaskDelegation = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
  readonly delegateDisplayName: string;
  readonly creatorUserId: string;
  readonly creatorDisplayName: string;
  readonly status: TaskDelegationStatus;
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
};
```

- [ ] **Step 2:** Создать `client/src/domain/task/TaskDelegation.ts` — точная копия (без `.js`-импортов; remove if any). Это mirror server-domain'а.

- [ ] **Step 3:** Расширить `Task` тип. В `server/src/domain/task/Task.ts` и `client/src/domain/task/Task.ts` добавить поле:

```ts
import type { TaskDelegation } from './TaskDelegation';
// в типе Task:
readonly delegation: TaskDelegation | null;
```

- [ ] **Step 4:** Verify (typecheck упадёт во многих местах где `Task` собирается — это ожидаемо, исправим в B5):

```bash
npm run typecheck
```
Ожидаемо: errors про missing `delegation`. Это нормально — обработаем в следующих task'ах.

- [ ] **Step 5:** Commit

```bash
git add server/src/domain/task/TaskDelegation.ts \
        client/src/domain/task/TaskDelegation.ts \
        server/src/domain/task/Task.ts \
        client/src/domain/task/Task.ts
git commit -m "feat(domain): TaskDelegation type + Task.delegation field"
```

---

### Task B3: `task/permissions.ts` helper

**Files:**
- Create: `server/src/domain/task/permissions.ts`

- [ ] **Step 1:** Создать `server/src/domain/task/permissions.ts`:

```ts
import type { Task } from './Task.js';
import type { TaskDelegation } from './TaskDelegation.js';

// Authorization helper для inbox-задач с делегированием.
// Creator (= owner inbox-проекта) и accepted-delegate имеют equal modify rights
// КРОМЕ delete (только creator).
//
// Для проектных (non-inbox) задач — обычная логика permissions/projectAccess проходит
// раньше; эта функция нужна когда у тебя на руках Task + Delegation.

export type TaskAccessReason = 'creator' | 'accepted_delegate';

export function canModifyTask(
  userId: string,
  task: Task,
  creatorUserId: string,
  delegation: TaskDelegation | null,
): TaskAccessReason | null {
  if (userId === creatorUserId) return 'creator';
  if (
    delegation !== null &&
    delegation.status === 'accepted' &&
    delegation.delegateUserId === userId
  ) {
    return 'accepted_delegate';
  }
  return null;
}

export function canDeleteTask(
  userId: string,
  creatorUserId: string,
): boolean {
  return userId === creatorUserId;
}
```

- [ ] **Step 2:** Verify

```bash
npm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add server/src/domain/task/permissions.ts
git commit -m "feat(domain): canModifyTask/canDeleteTask permission helpers"
```

---

### Task B4: TaskDelegationRepository — port + Drizzle impl

**Files:**
- Create: `server/src/application/task/TaskDelegationRepository.ts`
- Create: `server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts`

- [ ] **Step 1:** Создать `server/src/application/task/TaskDelegationRepository.ts`:

```ts
import type { TaskDelegation, TaskDelegationStatus } from '../../domain/task/TaskDelegation.js';

export type CreateDelegationInput = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
};

export type DelegationWithTaskInfo = TaskDelegation & {
  readonly taskExcerpt: string; // первые ~120 символов description
};

export interface TaskDelegationRepository {
  // Создаёт row с status='pending'. Если уже есть активная (pending|accepted) —
  // должен бросить error (вызывающий проверяет инвариант через findActiveForTask).
  create(input: CreateDelegationInput): Promise<TaskDelegation>;
  // Активная (pending|accepted) делегация для задачи. null если нет.
  findActiveForTask(taskId: string): Promise<TaskDelegation | null>;
  // По id (любой статус). null если не существует.
  getById(id: string): Promise<TaskDelegation | null>;
  // Обновить статус (+ responded_at). Возвращает обновлённую запись.
  setStatus(id: string, status: TaskDelegationStatus): Promise<TaskDelegation | null>;
  // Список pending для конкретного делегата — для верхнего блока в inbox.
  // Joined с описанием задачи (taskExcerpt) — чтобы UI рендерил без дополнительного fetch'а.
  listPendingForDelegate(userId: string): Promise<DelegationWithTaskInfo[]>;
  // Активные делегации для набора taskId — для list-tasks join'а.
  listActiveForTasks(taskIds: readonly string[]): Promise<Map<string, TaskDelegation>>;
}
```

- [ ] **Step 2:** Прочитать `server/src/infrastructure/repositories/DrizzleProjectInviteRepository.ts` для образца (похожий паттерн — простая таблица с status enum, joins с users).

- [ ] **Step 3:** Создать `server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { taskDelegations, users, tasks, projects } from '../db/schema.js';
import type {
  CreateDelegationInput,
  DelegationWithTaskInfo,
  TaskDelegationRepository,
} from '../../application/task/TaskDelegationRepository.js';
import type { TaskDelegation, TaskDelegationStatus } from '../../domain/task/TaskDelegation.js';

type Row = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegateDisplayName: string;
  creatorUserId: string;
  creatorDisplayName: string;
  status: TaskDelegationStatus;
  createdAt: Date;
  respondedAt: Date | null;
};

function toDomain(r: Row): TaskDelegation {
  return {
    id: r.id,
    taskId: r.taskId,
    delegateUserId: r.delegateUserId,
    delegateDisplayName: r.delegateDisplayName,
    creatorUserId: r.creatorUserId,
    creatorDisplayName: r.creatorDisplayName,
    status: r.status,
    createdAt: r.createdAt,
    respondedAt: r.respondedAt,
  };
}

const TASK_EXCERPT_LEN = 120;

export class DrizzleTaskDelegationRepository implements TaskDelegationRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateDelegationInput): Promise<TaskDelegation> {
    await this.db.insert(taskDelegations).values({
      id: input.id,
      taskId: input.taskId,
      delegateUserId: input.delegateUserId,
      status: 'pending',
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to create delegation');
    return created;
  }

  async findActiveForTask(taskId: string): Promise<TaskDelegation | null> {
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: users.displayName,
        creatorUserId: projects.ownerId,
        creatorDisplayName: users.displayName, // placeholder — переопределим join'ом ниже
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
      })
      .from(taskDelegations)
      .innerJoin(users, eq(users.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(taskDelegations.taskId, taskId),
          inArray(taskDelegations.status, ['pending', 'accepted']),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    // Второй query за creator'ом — чище чем второй join на users alias'ом.
    return this.enrichCreator(rows[0]);
  }

  async getById(id: string): Promise<TaskDelegation | null> {
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: users.displayName,
        creatorUserId: projects.ownerId,
        creatorDisplayName: users.displayName,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
      })
      .from(taskDelegations)
      .innerJoin(users, eq(users.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(taskDelegations.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return this.enrichCreator(rows[0]);
  }

  async setStatus(id: string, status: TaskDelegationStatus): Promise<TaskDelegation | null> {
    await this.db
      .update(taskDelegations)
      .set({ status, respondedAt: new Date() })
      .where(eq(taskDelegations.id, id));
    return this.getById(id);
  }

  async listPendingForDelegate(userId: string): Promise<DelegationWithTaskInfo[]> {
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: users.displayName,
        creatorUserId: projects.ownerId,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
        taskDescription: tasks.description,
      })
      .from(taskDelegations)
      .innerJoin(users, eq(users.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(taskDelegations.delegateUserId, userId),
          eq(taskDelegations.status, 'pending'),
        ),
      );
    const result: DelegationWithTaskInfo[] = [];
    for (const r of rows) {
      const creator = await this.getUserDisplayName(r.creatorUserId);
      result.push({
        ...toDomain({
          id: r.id,
          taskId: r.taskId,
          delegateUserId: r.delegateUserId,
          delegateDisplayName: r.delegateDisplayName,
          creatorUserId: r.creatorUserId,
          creatorDisplayName: creator,
          status: r.status,
          createdAt: r.createdAt,
          respondedAt: r.respondedAt,
        }),
        taskExcerpt: (r.taskDescription ?? '').slice(0, TASK_EXCERPT_LEN),
      });
    }
    return result;
  }

  async listActiveForTasks(taskIds: readonly string[]): Promise<Map<string, TaskDelegation>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: users.displayName,
        creatorUserId: projects.ownerId,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
      })
      .from(taskDelegations)
      .innerJoin(users, eq(users.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          inArray(taskDelegations.taskId, [...taskIds]),
          inArray(taskDelegations.status, ['pending', 'accepted']),
        ),
      );
    const map = new Map<string, TaskDelegation>();
    for (const r of rows) {
      const creator = await this.getUserDisplayName(r.creatorUserId);
      map.set(
        r.taskId,
        toDomain({
          id: r.id,
          taskId: r.taskId,
          delegateUserId: r.delegateUserId,
          delegateDisplayName: r.delegateDisplayName,
          creatorUserId: r.creatorUserId,
          creatorDisplayName: creator,
          status: r.status,
          createdAt: r.createdAt,
          respondedAt: r.respondedAt,
        }),
      );
    }
    return map;
  }

  private async enrichCreator(row: Row): Promise<TaskDelegation> {
    const creatorDisplayName = await this.getUserDisplayName(row.creatorUserId);
    return toDomain({ ...row, creatorDisplayName });
  }

  private async getUserDisplayName(userId: string): Promise<string> {
    const [u] = await this.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u?.displayName ?? '';
  }
}
```

> Если в `schema.ts` нет `projects.ownerId` — найти правильное имя поля (вероятно `ownerId` или `owner_id` через camelCase). Сверить с реальной схемой.

- [ ] **Step 4:** Verify

```bash
npm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add server/src/application/task/TaskDelegationRepository.ts \
        server/src/infrastructure/repositories/DrizzleTaskDelegationRepository.ts
git commit -m "feat(server): TaskDelegationRepository — port + Drizzle impl"
```

---

### Task B5: интеграция delegation в ListTasks (server) + Task DTO

**Files:**
- Modify: `server/src/application/task/ListTasks.ts`
- Modify: `server/src/application/task/CreateTask.ts` (return Task with delegation=null)
- Modify: `server/src/infrastructure/repositories/DrizzleTaskRepository.ts` (вернуть delegation=null или join'ить)
- Modify: `server/src/presentation/tasks/routes.ts` (DTO с delegation)

- [ ] **Step 1:** Прочитать `server/src/application/task/ListTasks.ts`. Добавить в deps `TaskDelegationRepository`. После получения tasks — `listActiveForTasks(taskIds)`, заполнить `delegation` поле каждой задачи.

- [ ] **Step 2:** В `DrizzleTaskRepository.ts` — везде где конструируется `Task`, добавить `delegation: null` (т.к. drizzle сам не подтянет это — это работа application-слоя через DelegationRepository).

- [ ] **Step 3:** В `server/src/presentation/tasks/routes.ts` — в `toDto` сериализовать `delegation` (даты → ISO-string).

  ```ts
  type TaskDtoDelegation = Omit<TaskDelegation, 'createdAt' | 'respondedAt'> & {
    createdAt: string;
    respondedAt: string | null;
  };
  // в toDto:
  delegation: t.delegation
    ? {
        ...t.delegation,
        createdAt: t.delegation.createdAt.toISOString(),
        respondedAt: t.delegation.respondedAt?.toISOString() ?? null,
      }
    : null,
  ```

- [ ] **Step 4:** Verify

```bash
npm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add server/src/application/task/ListTasks.ts \
        server/src/application/task/CreateTask.ts \
        server/src/infrastructure/repositories/DrizzleTaskRepository.ts \
        server/src/presentation/tasks/routes.ts
git commit -m "feat(server): join delegations в list-tasks + DTO"
```

---

### Task B6: ListSharedMembers use-case + ProjectMemberRepository extension

**Files:**
- Create: `server/src/application/project/ListSharedMembers.ts`
- Modify: `server/src/application/project/ProjectMemberRepository.ts` (interface)
- Modify: `server/src/infrastructure/repositories/DrizzleProjectMemberRepository.ts`
- Create: `server/src/presentation/me/sharedMembersRoutes.ts`
- Modify: `server/src/presentation/http.ts` (wire route)

- [ ] **Step 1:** В `ProjectMemberRepository.ts` интерфейс добавить:

```ts
// Дедуплицированный список user'ов, с которыми caller состоит в общих проектах.
// Без caller'а самого. Используется для дропдауна «делегировать».
listSharedUsers(userId: string): Promise<{ id: string; displayName: string; email: string }[]>;
```

- [ ] **Step 2:** В `DrizzleProjectMemberRepository.ts` реализовать. Логика SQL:

```sql
SELECT DISTINCT u.id, u.display_name, u.email
FROM users u
WHERE u.id != :userId
  AND u.id IN (
    SELECT pm2.user_id
    FROM project_members pm1
    JOIN project_members pm2 ON pm1.project_id = pm2.project_id
    WHERE pm1.user_id = :userId AND pm2.user_id != :userId
  );
```

В drizzle:
```ts
async listSharedUsers(userId: string) {
  // Inner: проекты, где состоит caller
  const myProjects = this.db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  // Outer: все members этих проектов, кроме самого caller'а, дедуплицировано
  const rows = await this.db
    .selectDistinct({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        inArray(projectMembers.projectId, myProjects),
        ne(projectMembers.userId, userId),
      ),
    );
  return rows;
}
```

- [ ] **Step 3:** Создать use-case `server/src/application/project/ListSharedMembers.ts`:

```ts
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';

export type SharedMember = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
};

export class ListSharedMembers {
  constructor(private readonly members: ProjectMemberRepository) {}

  async execute(userId: string): Promise<SharedMember[]> {
    return this.members.listSharedUsers(userId);
  }
}
```

- [ ] **Step 4:** Создать роут `server/src/presentation/me/sharedMembersRoutes.ts`:

```ts
import { Router, type Response } from 'express';
import type { ListSharedMembers } from '../../application/project/ListSharedMembers.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { AuthedRequest } from '../types.js';

type Deps = { readonly listSharedMembers: ListSharedMembers };

export function sharedMembersRouter(deps: Deps): Router {
  const r = Router();
  r.use(requireAuth);
  r.get('/shared-members', async (req: AuthedRequest, res: Response) => {
    const members = await deps.listSharedMembers.execute(req.session!.userId);
    res.json({ members });
  });
  return r;
}
```

- [ ] **Step 5:** В `server/src/presentation/http.ts` — найти где монтируется `/api/users/me/...` или эквивалент, и зарегистрировать роут под `/api/users/me`. (Может быть уже `meRouter` — добавить туда.) Точное имя файла/функции уточнить чтением http.ts.

- [ ] **Step 6:** Verify

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 7:** Commit

```bash
git add server/src/application/project/ListSharedMembers.ts \
        server/src/application/project/ProjectMemberRepository.ts \
        server/src/infrastructure/repositories/DrizzleProjectMemberRepository.ts \
        server/src/presentation/me/sharedMembersRoutes.ts \
        server/src/presentation/http.ts
git commit -m "feat(server): GET /api/users/me/shared-members"
```

---

### Task B7: Notification types + email templates

**Files:**
- Modify: `server/src/domain/notifications/Notification.ts`
- Modify: `client/src/domain/notifications/Notification.ts` (mirror)
- Create: `server/src/application/notifications/emails/delegationEmail.ts`
- Create: `server/src/application/notifications/emails/delegationDeclinedEmail.ts`
- Create: `server/src/application/notifications/emails/taskAssignedToProjectEmail.ts`

- [ ] **Step 1:** В `server/src/domain/notifications/Notification.ts` — добавить три новых payload-типа в discriminated union:

```ts
export type TaskDelegationPayload = {
  readonly type: 'task_delegation';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

export type TaskDelegationResolvedPayload = {
  readonly type: 'task_delegation_resolved';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly resolution: 'accepted' | 'declined';
  readonly delegateUserId: string;
  readonly delegateDisplayName: string;
};

export type TaskAssignedToProjectPayload = {
  readonly type: 'task_assigned_to_project';
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Добавить в union:
export type NotificationPayload =
  | CommentMentionPayload
  | ProjectInvitePayload
  | JoinRequestPayload
  | TaskDelegationPayload
  | TaskDelegationResolvedPayload
  | TaskAssignedToProjectPayload;
```

- [ ] **Step 2:** Точно зеркально обновить `client/src/domain/notifications/Notification.ts`.

- [ ] **Step 3:** Создать `server/src/application/notifications/emails/delegationEmail.ts` — копи-паттерн из `inviteEmail.ts`. Subject: «{actor} делегировал вам задачу в ProjectsFlow». Кнопки «Принять» (зелёная) и «Отклонить» (серая), обе ведут на `{APP_URL}/inbox#delegation={id}` (одинаковый URL — пользователь действует в UI, не magic-token):

```ts
import type { EmailMessage } from '../EmailSender.js';

export type DelegationEmailInput = {
  readonly to: string;
  readonly actorDisplayName: string;
  readonly taskExcerpt: string;
  readonly inboxUrl: string;
};

export function renderDelegationEmail(input: DelegationEmailInput): EmailMessage {
  const subject = `${input.actorDisplayName} делегировал вам задачу в ProjectsFlow`;
  const text = [
    `${input.actorDisplayName} делегировал вам задачу:`,
    '',
    `«${input.taskExcerpt}»`,
    '',
    `Открыть «Входящие»: ${input.inboxUrl}`,
    '',
    'Там можно принять или отклонить.',
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="ru">
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Вам делегировали задачу</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
            <strong style="color:#0f172a;">${input.actorDisplayName}</strong> просит вас выполнить задачу:
          </p>
          <blockquote style="margin:12px 0 0;padding:12px 14px;border-left:3px solid #2563eb;background:#f8fafc;font-size:14px;line-height:1.5;color:#0f172a;">
            ${input.taskExcerpt}
          </blockquote>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.inboxUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;margin-right:8px;">
            Принять
          </a>
          <a href="${input.inboxUrl}" style="display:inline-block;background:#e2e8f0;color:#475569;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;">
            Отклонить
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Открыть «Входящие»: <a href="${input.inboxUrl}" style="color:#2563eb;word-break:break-all;">${input.inboxUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Если это ошибка — просто проигнорируйте.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { to: input.to, subject, html, text };
}
```

- [ ] **Step 4:** Создать `delegationDeclinedEmail.ts` (subject «{delegate} отклонил вашу задачу») и `taskAssignedToProjectEmail.ts` (subject «Задача перенесена в проект {projectName}»). Структура такая же — inline CSS, blockquote с описанием, ссылка на inbox/project.

- [ ] **Step 5:** Verify

```bash
npm run typecheck
```

- [ ] **Step 6:** Commit

```bash
git add server/src/domain/notifications/Notification.ts \
        client/src/domain/notifications/Notification.ts \
        server/src/application/notifications/emails/delegationEmail.ts \
        server/src/application/notifications/emails/delegationDeclinedEmail.ts \
        server/src/application/notifications/emails/taskAssignedToProjectEmail.ts
git commit -m "feat(notifications): три новых payload-типа для делегирования + email templates"
```

---

### Task B8: CreateInboxTaskWithDelegation — расширение CreateTask

**Files:**
- Modify: `server/src/application/task/CreateTask.ts`
- Modify: `server/src/presentation/tasks/routes.ts` (POST handler — pass delegateUserId)
- Modify: `server/src/presentation/tasks/schemas.ts` (createTaskSchema добавить delegateUserId)

- [ ] **Step 1:** В `createTaskSchema` (schemas.ts) добавить:

```ts
export const createTaskSchema = z.object({
  description: z.string().trim().min(1).max(5000),
  status: taskStatusSchema.optional(),
  ralphMode: ralphModeSchema.optional(),
  delegateUserId: z.string().uuid().nullable().optional(),
});
```

- [ ] **Step 2:** В `CreateTask.ts` — расширить Deps (добавить `delegations: TaskDelegationRepository`, `members: ProjectMemberRepository` уже есть, `notifications: ... — публикация`, `idGen` уже есть, `sendEmail` — для рассылки) и command:

```ts
export type CreateTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly ralphMode?: RalphMode;
  readonly delegateUserId?: string | null;
};
```

Логика execute:
1. Проверить description, project access (как раньше).
2. Создать task.
3. Если `delegateUserId` указан:
   a. Проверить что delegateUserId !== ownerUserId (BadRequest).
   b. Проверить что delegate в shared-members списке (`members.listSharedUsers(ownerUserId)`); иначе ForbiddenError.
   c. Проверить что project — inbox (`projects.getById(projectId).isInbox`); иначе BadRequest.
   d. Создать delegation row через `delegations.create({ id: idGen(), taskId: task.id, delegateUserId })`.
   e. Опубликовать `task_delegation` notification + email через `EmailSender`.
4. Вернуть task с `delegation` (или null если не было).

Точный код:

```ts
async execute(input: CreateTaskCommand): Promise<Task> {
  const description = input.description.trim();
  if (description.length === 0) throw new TaskDescriptionEmptyError();

  await requireProjectAccess(this.deps, input.projectId, input.ownerUserId, 'create_task');

  const bounds = await this.deps.tasks.getPositionBounds(input.projectId, input.status);
  const position = bounds ? bounds.min - POSITION_STEP : POSITION_STEP;

  const task = await this.deps.tasks.create({
    id: this.deps.idGen(),
    projectId: input.projectId,
    description,
    status: input.status,
    position,
    ralphMode: input.ralphMode,
  });

  let delegation: TaskDelegation | null = null;

  if (input.delegateUserId) {
    // Self-delegation forbidden.
    if (input.delegateUserId === input.ownerUserId) {
      throw new SelfDelegationError();
    }
    // Project must be inbox.
    const project = await this.deps.projects.getById(input.projectId);
    if (!project?.isInbox) {
      throw new DelegationOnNonInboxError();
    }
    // Delegate must be in shared members (security).
    const shared = await this.deps.members.listSharedUsers(input.ownerUserId);
    if (!shared.find((u) => u.id === input.delegateUserId)) {
      throw new DelegateNotInSharedMembersError();
    }
    delegation = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId: task.id,
      delegateUserId: input.delegateUserId,
    });

    // Опубликовать notification + email (best-effort).
    void this.deps.notifyDelegationCreated({
      delegation,
      taskExcerpt: description.slice(0, 120),
      creatorDisplayName: delegation.creatorDisplayName,
      creatorUserId: input.ownerUserId,
    });
  }

  return { ...task, delegation };
}
```

Заведи новые ошибки в `server/src/domain/task/errors.ts`:
```ts
export class SelfDelegationError extends Error {
  readonly status = 400;
  constructor() { super('Нельзя делегировать самому себе'); this.name = 'SelfDelegationError'; }
}
export class DelegationOnNonInboxError extends Error {
  readonly status = 400;
  constructor() { super('Делегировать можно только inbox-задачи'); this.name = 'DelegationOnNonInboxError'; }
}
export class DelegateNotInSharedMembersError extends Error {
  readonly status = 403;
  constructor() { super('Этому пользователю нельзя делегировать'); this.name = 'DelegateNotInSharedMembersError'; }
}
```

`notifyDelegationCreated` — новый callback в Deps (тип):
```ts
readonly notifyDelegationCreated: (args: {
  delegation: TaskDelegation;
  taskExcerpt: string;
  creatorDisplayName: string;
  creatorUserId: string;
}) => void;
```

Реализация callback'а — в http.ts при wiring (NotificationPublisher.publish + EmailSender.send).

- [ ] **Step 3:** В `routes.ts` (POST /projects/:id/tasks handler) — пробросить `delegateUserId` из body в CreateTaskCommand.

- [ ] **Step 4:** Verify

```bash
npm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add server/src/application/task/CreateTask.ts \
        server/src/domain/task/errors.ts \
        server/src/presentation/tasks/routes.ts \
        server/src/presentation/tasks/schemas.ts
git commit -m "feat(server): CreateTask с опциональным delegateUserId"
```

---

### Task B9: Accept/Decline/Withdraw use-cases + Pending/AssignToProject

**Files:**
- Create: `server/src/application/task/AcceptTaskDelegation.ts`
- Create: `server/src/application/task/DeclineTaskDelegation.ts`
- Create: `server/src/application/task/WithdrawTaskDelegation.ts`
- Create: `server/src/application/task/ListMyPendingDelegations.ts`
- Create: `server/src/application/task/AssignInboxTaskToProject.ts`

- [ ] **Step 1:** `AcceptTaskDelegation.ts`:

```ts
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import {
  DelegationNotFoundError,
  DelegationWrongStateError,
  NotDelegateError,
} from '../../domain/task/errors.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
  readonly notifyResolved: (args: {
    delegation: TaskDelegation;
    resolution: 'accepted' | 'declined';
  }) => void;
};

export class AcceptTaskDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(delegationId: string, userId: string): Promise<TaskDelegation> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError();
    if (existing.delegateUserId !== userId) throw new NotDelegateError();
    if (existing.status !== 'pending') throw new DelegationWrongStateError(existing.status, 'pending');

    const updated = await this.deps.delegations.setStatus(delegationId, 'accepted');
    if (!updated) throw new DelegationNotFoundError();

    void this.deps.notifyResolved({ delegation: updated, resolution: 'accepted' });
    return updated;
  }
}
```

- [ ] **Step 2:** `DeclineTaskDelegation.ts` — аналогично, статус → `declined`. Notify resolution='declined' (с email-вариантом — обработчик в http.ts).

- [ ] **Step 3:** `WithdrawTaskDelegation.ts`:

```ts
type Deps = {
  readonly delegations: TaskDelegationRepository;
};
export class WithdrawTaskDelegation {
  constructor(private readonly deps: Deps) {}
  async execute(delegationId: string, userId: string): Promise<void> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError();
    if (existing.creatorUserId !== userId) throw new NotCreatorError();
    if (existing.status !== 'pending') throw new DelegationWrongStateError(existing.status, 'pending');
    await this.deps.delegations.setStatus(delegationId, 'withdrawn');
    // Notification делегату не шлём (он ещё не действовал).
  }
}
```

- [ ] **Step 4:** `ListMyPendingDelegations.ts`:

```ts
export class ListMyPendingDelegations {
  constructor(private readonly delegations: TaskDelegationRepository) {}
  async execute(userId: string) {
    return this.delegations.listPendingForDelegate(userId);
  }
}
```

- [ ] **Step 5:** `AssignInboxTaskToProject.ts`:

```ts
import type { TaskRepository } from './TaskRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import { TaskNotFoundError, NotInboxTaskError, TargetProjectNotInboxError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';

type Deps = {
  readonly tasks: TaskRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly delegations: TaskDelegationRepository;
  readonly notifyAssigned: (args: {
    task: Task;
    targetProjectId: string;
    targetProjectName: string;
    actorUserId: string;
    actorDisplayName: string;
    delegateUserId: string | null;
  }) => void;
};

export class AssignInboxTaskToProject {
  constructor(private readonly deps: Deps) {}

  async execute(taskId: string, targetProjectId: string, userId: string): Promise<Task> {
    const task = await this.deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError();

    const sourceProject = await this.deps.projects.getById(task.projectId);
    if (!sourceProject?.isInbox) throw new NotInboxTaskError();
    if (sourceProject.ownerId !== userId) throw new NotCreatorError(); // only creator can assign

    const targetProject = await this.deps.projects.getById(targetProjectId);
    if (!targetProject) throw new TargetProjectNotFoundError();
    if (targetProject.isInbox) throw new TargetProjectNotInboxError();
    // Target должен быть мой (член).
    await requireProjectAccess(this.deps, targetProjectId, userId, 'modify');

    // Move task.
    const moved = await this.deps.tasks.update(taskId, { /* projectId смена через update НЕ работает —
      нужен отдельный repo-метод. Добавлю moveToProject. */ });

    // Archive active delegation (если есть).
    const active = await this.deps.delegations.findActiveForTask(taskId);
    let delegateUserId: string | null = null;
    if (active) {
      delegateUserId = active.delegateUserId;
      await this.deps.delegations.setStatus(active.id, 'archived');
    }

    void this.deps.notifyAssigned({
      task: moved!,
      targetProjectId,
      targetProjectName: targetProject.name,
      actorUserId: userId,
      actorDisplayName: '', // подставить fetch'ем user'а — лучше в callback'е
      delegateUserId,
    });

    return moved!;
  }
}
```

Заведи метод `taskRepository.moveToProject(taskId, targetProjectId)` в port'е и реализуй в Drizzle (`UPDATE tasks SET project_id = ? WHERE id = ?`).

Заведи новые ошибки:
```ts
export class DelegationNotFoundError extends Error { readonly status = 404; ... }
export class DelegationWrongStateError extends Error { readonly status = 409; constructor(got, expected) { super(`Ожидался статус ${expected}, текущий ${got}`); } }
export class NotDelegateError extends Error { readonly status = 403; ... }
export class NotCreatorError extends Error { readonly status = 403; ... }
export class TaskNotFoundError extends Error { readonly status = 404; ... }
export class NotInboxTaskError extends Error { readonly status = 400; ... }
export class TargetProjectNotFoundError extends Error { readonly status = 404; ... }
export class TargetProjectNotInboxError extends Error { readonly status = 400; ... }
```

- [ ] **Step 6:** Verify

```bash
npm run typecheck
```

- [ ] **Step 7:** Commit

```bash
git add server/src/application/task/AcceptTaskDelegation.ts \
        server/src/application/task/DeclineTaskDelegation.ts \
        server/src/application/task/WithdrawTaskDelegation.ts \
        server/src/application/task/ListMyPendingDelegations.ts \
        server/src/application/task/AssignInboxTaskToProject.ts \
        server/src/application/task/TaskRepository.ts \
        server/src/infrastructure/repositories/DrizzleTaskRepository.ts \
        server/src/domain/task/errors.ts
git commit -m "feat(server): accept/decline/withdraw + listPending + assignToProject use-cases"
```

---

### Task B10: Authorization update в существующих use-cases

**Files:**
- Modify: `server/src/application/task/MoveTask.ts`
- Modify: `server/src/application/task/UpdateTask.ts`
- Modify: `server/src/application/task/DeleteTask.ts`
- Modify: `server/src/application/task/CreateTaskComment.ts`
- Modify: `server/src/application/task/UpdateTaskComment.ts`
- Modify: `server/src/application/task/DeleteTaskComment.ts`
- Modify: `server/src/application/task/UploadTaskAttachment.ts`
- Modify: `server/src/application/task/DeleteTaskAttachment.ts`

- [ ] **Step 1:** Стратегия: создать helper `assertCanModifyTask(deps, taskId, userId)`:

  ```ts
  // server/src/application/task/taskAuthorization.ts
  import type { TaskRepository } from './TaskRepository.js';
  import type { ProjectRepository } from '../project/ProjectRepository.js';
  import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
  import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
  import { canModifyTask, canDeleteTask } from '../../domain/task/permissions.js';
  import { TaskNotFoundError, ForbiddenError } from '../../domain/task/errors.js';
  import { requireProjectAccess } from '../project/projectAccess.js';

  type Deps = {
    readonly tasks: TaskRepository;
    readonly projects: ProjectRepository;
    readonly members: ProjectMemberRepository;
    readonly delegations: TaskDelegationRepository;
  };

  export async function assertCanModifyTask(deps: Deps, taskId: string, userId: string) {
    const task = await deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError();
    const project = await deps.projects.getById(task.projectId);
    if (!project) throw new TaskNotFoundError();

    // Если не-inbox — обычная проверка через requireProjectAccess.
    if (!project.isInbox) {
      await requireProjectAccess(deps, task.projectId, userId, 'modify');
      return { task, project, delegation: null as TaskDelegation | null };
    }

    // Inbox: либо owner проекта (creator), либо accepted-delegate.
    const delegation = await deps.delegations.findActiveForTask(taskId);
    const reason = canModifyTask(userId, task, project.ownerId, delegation);
    if (!reason) throw new ForbiddenError();
    return { task, project, delegation };
  }

  export async function assertCanDeleteTask(deps: Deps, taskId: string, userId: string) {
    const task = await deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError();
    const project = await deps.projects.getById(task.projectId);
    if (!project) throw new TaskNotFoundError();
    if (project.isInbox) {
      if (!canDeleteTask(userId, project.ownerId)) throw new ForbiddenError();
      return;
    }
    await requireProjectAccess(deps, task.projectId, userId, 'modify');
  }
  ```

- [ ] **Step 2:** Заменить `requireProjectAccess(...)` на `assertCanModifyTask(deps, taskId, userId)` (для inbox-aware use-cases). В DeleteTask — `assertCanDeleteTask`.

- [ ] **Step 3:** Verify

```bash
npm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add server/src/application/task/taskAuthorization.ts \
        server/src/application/task/MoveTask.ts \
        server/src/application/task/UpdateTask.ts \
        server/src/application/task/DeleteTask.ts \
        server/src/application/task/CreateTaskComment.ts \
        server/src/application/task/UpdateTaskComment.ts \
        server/src/application/task/DeleteTaskComment.ts \
        server/src/application/task/UploadTaskAttachment.ts \
        server/src/application/task/DeleteTaskAttachment.ts
git commit -m "feat(server): inbox-аware authorization (creator + accepted delegate)"
```

---

### Task B11: HTTP routes — delegations + assignToProject + extend tasks

**Files:**
- Create: `server/src/presentation/delegations/routes.ts`
- Create: `server/src/presentation/delegations/schemas.ts`
- Modify: `server/src/presentation/tasks/routes.ts` (добавить POST /:taskId/assign-to-project)
- Modify: `server/src/presentation/tasks/schemas.ts`
- Modify: `server/src/presentation/http.ts`

- [ ] **Step 1:** Создать `schemas.ts`:

```ts
import { z } from 'zod';
export const assignToProjectSchema = z.object({
  targetProjectId: z.string().uuid(),
});
```

- [ ] **Step 2:** Создать `delegations/routes.ts`:

```ts
import { Router, type Response } from 'express';
import type { AcceptTaskDelegation } from '../../application/task/AcceptTaskDelegation.js';
import type { DeclineTaskDelegation } from '../../application/task/DeclineTaskDelegation.js';
import type { WithdrawTaskDelegation } from '../../application/task/WithdrawTaskDelegation.js';
import type { ListMyPendingDelegations } from '../../application/task/ListMyPendingDelegations.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { AuthedRequest } from '../types.js';

type Deps = {
  readonly accept: AcceptTaskDelegation;
  readonly decline: DeclineTaskDelegation;
  readonly withdraw: WithdrawTaskDelegation;
  readonly listPending: ListMyPendingDelegations;
};

function delegationToDto(d: TaskDelegation) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    respondedAt: d.respondedAt?.toISOString() ?? null,
  };
}

export function delegationsRouter(deps: Deps): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/pending', async (req: AuthedRequest, res: Response) => {
    const items = await deps.listPending.execute(req.session!.userId);
    res.json({ delegations: items.map(delegationToDto) });
  });

  r.post('/:id/accept', async (req: AuthedRequest, res: Response) => {
    const d = await deps.accept.execute(req.params.id, req.session!.userId);
    res.json({ delegation: delegationToDto(d) });
  });

  r.post('/:id/decline', async (req: AuthedRequest, res: Response) => {
    const d = await deps.decline.execute(req.params.id, req.session!.userId);
    res.json({ delegation: delegationToDto(d) });
  });

  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
    await deps.withdraw.execute(req.params.id, req.session!.userId);
    res.status(204).end();
  });

  return r;
}
```

- [ ] **Step 3:** В `tasks/routes.ts` добавить handler POST `/:taskId/assign-to-project`:

```ts
r.post('/:taskId/assign-to-project', async (req, res) => {
  const { targetProjectId } = assignToProjectSchema.parse(req.body);
  const task = await deps.assignToProject.execute(
    req.params.taskId,
    targetProjectId,
    req.session!.userId,
  );
  res.json({ task: toDto(task) });
});
```

- [ ] **Step 4:** В `http.ts`:
  - Создать инстансы `AcceptTaskDelegation`, `DeclineTaskDelegation`, `WithdrawTaskDelegation`, `ListMyPendingDelegations`, `AssignInboxTaskToProject`.
  - Реализовать callback'и `notifyDelegationCreated`/`notifyResolved`/`notifyAssigned` — внутри они вызывают `NotificationPublisher.publish` + `EmailSender.send` (используют новые email templates). См. как сейчас `ProjectNotificationService` или `notifyInviteCreated` устроен.
  - Замонтировать роутер `app.use('/api/delegations', delegationsRouter({ ... }))`.

- [ ] **Step 5:** Verify

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 6:** Commit

```bash
git add server/src/presentation/delegations/ \
        server/src/presentation/tasks/routes.ts \
        server/src/presentation/tasks/schemas.ts \
        server/src/presentation/http.ts
git commit -m "feat(server): HTTP routes для делегирования (accept/decline/withdraw/pending/assign)"
```

---

## Phase B — Client

### Task B12: client port + HTTP impl

**Files:**
- Create: `client/src/application/task/TaskDelegationRepository.ts`
- Create: `client/src/infrastructure/http/HttpTaskDelegationRepository.ts`
- Modify: `client/src/application/task/TaskRepository.ts` (extend CreateTaskInput + assignToProject)
- Modify: `client/src/infrastructure/http/HttpTaskRepository.ts`
- Modify: `client/src/application/project/ProjectRepository.ts` (listSharedMembers + SharedMember type)
- Modify: `client/src/infrastructure/http/HttpProjectRepository.ts`
- Modify: `client/src/infrastructure/di/container.tsx`

- [ ] **Step 1:** `application/task/TaskDelegationRepository.ts`:

```ts
import type { TaskDelegation } from '@/domain/task/TaskDelegation';

export type PendingDelegation = TaskDelegation & {
  readonly taskExcerpt: string;
};

export interface TaskDelegationRepository {
  listMyPending(): Promise<PendingDelegation[]>;
  accept(id: string): Promise<TaskDelegation>;
  decline(id: string): Promise<TaskDelegation>;
  withdraw(id: string): Promise<void>;
}
```

- [ ] **Step 2:** `HttpTaskDelegationRepository.ts`:

```ts
import { httpClient } from './httpClient';
import type {
  PendingDelegation,
  TaskDelegationRepository,
} from '@/application/task/TaskDelegationRepository';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';

type DelegationDto = Omit<TaskDelegation, 'createdAt' | 'respondedAt'> & {
  createdAt: string;
  respondedAt: string | null;
};

type PendingDto = DelegationDto & { taskExcerpt: string };

function fromDto(dto: DelegationDto): TaskDelegation {
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    respondedAt: dto.respondedAt ? new Date(dto.respondedAt) : null,
  };
}

export class HttpTaskDelegationRepository implements TaskDelegationRepository {
  async listMyPending(): Promise<PendingDelegation[]> {
    const { delegations } = await httpClient.get<{ delegations: PendingDto[] }>(
      '/delegations/pending',
    );
    return delegations.map((d) => ({ ...fromDto(d), taskExcerpt: d.taskExcerpt }));
  }
  async accept(id: string): Promise<TaskDelegation> {
    const { delegation } = await httpClient.post<{ delegation: DelegationDto }>(
      `/delegations/${id}/accept`,
      {},
    );
    return fromDto(delegation);
  }
  async decline(id: string): Promise<TaskDelegation> {
    const { delegation } = await httpClient.post<{ delegation: DelegationDto }>(
      `/delegations/${id}/decline`,
      {},
    );
    return fromDto(delegation);
  }
  async withdraw(id: string): Promise<void> {
    await httpClient.delete<void>(`/delegations/${id}`);
  }
}
```

- [ ] **Step 3:** В `application/task/TaskRepository.ts`:

```ts
export type CreateTaskInput = {
  readonly description: string;
  readonly status?: TaskStatus;
  readonly ralphMode?: RalphMode;
  readonly delegateUserId?: string | null;
};

// В TaskRepository interface добавить:
assignToProject(taskId: string, targetProjectId: string): Promise<Task>;
```

- [ ] **Step 4:** В `HttpTaskRepository.ts`:
  - Extend DTO mapper чтобы делать `delegation` field (fromDto):
  ```ts
  type TaskDtoDelegation = { id: string; taskId: string; ... createdAt: string; respondedAt: string | null };
  type TaskDto = ... & { delegation?: TaskDtoDelegation | null };

  function fromDto(dto: TaskDto): Task {
    return {
      ...,
      delegation: dto.delegation
        ? {
            ...dto.delegation,
            createdAt: new Date(dto.delegation.createdAt),
            respondedAt: dto.delegation.respondedAt ? new Date(dto.delegation.respondedAt) : null,
          }
        : null,
    };
  }
  ```
  - Добавить метод:
  ```ts
  async assignToProject(taskId: string, targetProjectId: string): Promise<Task> {
    const { task } = await httpClient.post<{ task: TaskDto }>(
      `/tasks/${taskId}/assign-to-project`,
      { targetProjectId },
    );
    return fromDto(task);
  }
  ```

- [ ] **Step 5:** В `application/project/ProjectRepository.ts`:

```ts
export type SharedMember = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
};

// В interface:
listSharedMembers(): Promise<SharedMember[]>;
```

- [ ] **Step 6:** В `HttpProjectRepository.ts`:

```ts
async listSharedMembers(): Promise<SharedMember[]> {
  const { members } = await httpClient.get<{ members: SharedMember[] }>(
    '/users/me/shared-members',
  );
  return members;
}
```

- [ ] **Step 7:** В `container.tsx` зарегистрировать новый repo:

```ts
import { HttpTaskDelegationRepository } from '@/infrastructure/http/HttpTaskDelegationRepository';
import type { TaskDelegationRepository } from '@/application/task/TaskDelegationRepository';

type Container = {
  ...
  taskDelegationRepository: TaskDelegationRepository;
};

function buildContainer() {
  ...
  const taskDelegationRepo = new HttpTaskDelegationRepository();
  return {
    ...,
    taskDelegationRepository: taskDelegationRepo,
  };
}
```

- [ ] **Step 8:** Verify

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 9:** Commit

```bash
git add client/src/application/task/TaskDelegationRepository.ts \
        client/src/infrastructure/http/HttpTaskDelegationRepository.ts \
        client/src/application/task/TaskRepository.ts \
        client/src/infrastructure/http/HttpTaskRepository.ts \
        client/src/application/project/ProjectRepository.ts \
        client/src/infrastructure/http/HttpProjectRepository.ts \
        client/src/infrastructure/di/container.tsx
git commit -m "feat(client): TaskDelegationRepository + Task.delegation + assignToProject"
```

---

### Task B13: UI компоненты — DelegateSelect, DelegationBadge, PendingDelegationsBlock, AssignToProjectSelect

**Files:**
- Create: `client/src/presentation/components/tasks/DelegateSelect.tsx`
- Create: `client/src/presentation/components/tasks/DelegationBadge.tsx`
- Create: `client/src/presentation/components/tasks/PendingDelegationsBlock.tsx`
- Create: `client/src/presentation/components/tasks/AssignToProjectSelect.tsx`

- [ ] **Step 1:** `DelegateSelect.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ChevronDown, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useContainer } from '@/infrastructure/di/container';
import type { SharedMember } from '@/application/project/ProjectRepository';

type Props = {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
};

// Дропдаун выбора делегата при создании inbox-задачи. Single-select.
// Список — люди из моих shared-проектов (без меня самого).
export function DelegateSelect({ value, onChange, disabled }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [members, setMembers] = useState<SharedMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectRepository.listSharedMembers().then((list) => {
      if (!cancelled) setMembers(list);
    });
    return () => { cancelled = true; };
  }, [projectRepository]);

  const selected = members?.find((m) => m.id === value) ?? null;
  const label = selected ? selected.displayName : 'Не делегировать';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <User className="size-3.5" />
          {label}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        <DropdownMenuItem onClick={() => onChange(null)}>
          Не делегировать
        </DropdownMenuItem>
        {(members ?? []).map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)}>
            {m.displayName} <span className="ml-auto text-[10px] text-muted-foreground">{m.email}</span>
          </DropdownMenuItem>
        ))}
        {members && members.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Нет общих участников. Пригласите кого-то в проект.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2:** `DelegationBadge.tsx`:

```tsx
import { Send, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';

type Props = {
  delegation: TaskDelegation;
  // Текущий пользователь — определить, я создатель или делегат, чтобы выбрать
  // правильный вариант ярлыка («Делегировано: Х» или «От: Y»).
  currentUserId: string;
};

export function DelegationBadge({ delegation, currentUserId }: Props): React.ReactElement {
  const isCreator = delegation.creatorUserId === currentUserId;
  const isAccepted = delegation.status === 'accepted';
  const isPending = delegation.status === 'pending';
  const label = isCreator
    ? `Делегировано: ${delegation.delegateDisplayName}${isPending ? ' (ожидает)' : ''}`
    : `От: ${delegation.creatorDisplayName}`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
        isAccepted
          ? 'bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400'
          : 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400',
      )}
      title={delegation.status}
    >
      {isCreator ? <Send className="size-2.5" /> : <UserCheck className="size-2.5" />}
      {label}
    </span>
  );
}
```

- [ ] **Step 3:** `PendingDelegationsBlock.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useContainer } from '@/infrastructure/di/container';
import { getInitials } from '@/presentation/layout/projectIcons';
import type { PendingDelegation } from '@/application/task/TaskDelegationRepository';

type Props = {
  // Колбэк после accept/decline — InboxPage должен refetch'нуть задачи.
  onChanged: () => void;
};

export function PendingDelegationsBlock({ onChanged }: Props): React.ReactElement | null {
  const { taskDelegationRepository } = useContainer();
  const [items, setItems] = useState<PendingDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const refresh = async (): Promise<void> => {
    try {
      const list = await taskDelegationRepository.listMyPending();
      setItems(list);
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh().then(() => { if (cancelled) setItems([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle = async (id: string, action: 'accept' | 'decline'): Promise<void> => {
    setPendingIds((s) => new Set(s).add(id));
    try {
      if (action === 'accept') {
        await taskDelegationRepository.accept(id);
        toast.success('Задача принята');
      } else {
        await taskDelegationRepository.decline(id);
        toast.success('Задача отклонена');
      }
      setItems((prev) => prev.filter((d) => d.id !== id));
      onChanged();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section
      id="delegation"
      className="space-y-2 rounded-lg border border-amber-300/50 bg-amber-50/40 p-3 dark:border-amber-400/30 dark:bg-amber-950/20"
    >
      <h2 className="text-sm font-medium text-amber-900 dark:text-amber-200">
        Делегировано мне ({items.length})
      </h2>
      <ul className="space-y-1.5">
        {items.map((d) => (
          <li key={d.id} className="flex items-start gap-3 rounded-md bg-card px-3 py-2">
            <Avatar className="size-7 shrink-0">
              <AvatarFallback className="text-[11px]">
                {getInitials(d.creatorDisplayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug">
                <span className="font-medium">{d.creatorDisplayName}</span> делегировал вам:
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">«{d.taskExcerpt}»</p>
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700"
                disabled={pendingIds.has(d.id)}
                onClick={() => void handle(d.id, 'accept')}
              >
                <Check className="size-3.5" />
                Принять
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-muted-foreground"
                disabled={pendingIds.has(d.id)}
                onClick={() => void handle(d.id, 'decline')}
              >
                <X className="size-3.5" />
                Отклонить
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4:** `AssignToProjectSelect.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ChevronDown, FolderInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';

type Props = {
  task: Task;
  onAssigned: () => void;
};

// Селект «Перенести в проект» в шапке TaskDrawer для inbox-задач.
export function AssignToProjectSelect({ task, onAssigned }: Props): React.ReactElement {
  const { projectRepository, taskRepository } = useContainer();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectRepository.list().then((list) => {
      if (!cancelled) setProjects(list.filter((p) => !p.isInbox));
    });
    return () => { cancelled = true; };
  }, [projectRepository]);

  const handle = async (projectId: string): Promise<void> => {
    if (submitting) return;
    if (!window.confirm('Перенести задачу в выбранный проект? Она исчезнет из «Входящих».')) return;
    setSubmitting(true);
    try {
      await taskRepository.assignToProject(task.id, projectId);
      toast.success('Задача перенесена');
      onAssigned();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          <FolderInput className="size-3.5" />
          Перенести в проект
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {(projects ?? []).map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => void handle(p.id)}>
            {p.name}
          </DropdownMenuItem>
        ))}
        {projects && projects.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Нет проектов</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5:** Verify

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6:** Commit

```bash
git add client/src/presentation/components/tasks/DelegateSelect.tsx \
        client/src/presentation/components/tasks/DelegationBadge.tsx \
        client/src/presentation/components/tasks/PendingDelegationsBlock.tsx \
        client/src/presentation/components/tasks/AssignToProjectSelect.tsx
git commit -m "feat(client): UI компоненты делегирования"
```

---

### Task B14: интеграция в QuickAddTodo + TaskDrawer (create-mode для inbox)

**Files:**
- Modify: `client/src/presentation/components/tasks/QuickAddTodo.tsx`
- Modify: `client/src/presentation/components/tasks/TaskDrawer.tsx`
- Modify: `client/src/presentation/components/tasks/TaskListView.tsx` (передать isInbox в QuickAdd)
- Modify: `client/src/presentation/components/tasks/KanbanBoard.tsx`

- [ ] **Step 1:** В `QuickAddTodo.tsx`:
  - Принять prop `isInbox: boolean`.
  - Добавить state `delegateUserId: string | null`.
  - В footer (рядом с RalphModeSelect) — если `isInbox`, рендер `<DelegateSelect value={delegateUserId} onChange={setDelegateUserId} disabled={submitting} />`.
  - При submit — пробрасывать `delegateUserId` в `onCreate({ description, ralphMode, delegateUserId })`.
  - Type signature `onCreate` обновить: `{ description: string; ralphMode?: RalphMode; delegateUserId?: string | null }`.

- [ ] **Step 2:** Использовать в `KanbanBoard.tsx` / `TaskListView.tsx` — передать `isInbox` (true когда `showCommits === false`).

- [ ] **Step 3:** В `TaskDrawer.tsx` (create-mode):
  - Если контекст inbox — рендер `DelegateSelect` под `RalphModeSelect`.
  - Передавать `delegateUserId` в onSubmit.
  - Обновить TaskDrawer onSubmit signature.

  Точные изменения сложнее — нужно прочитать TaskDrawer и понять структуру composer'а. Шаги:
  - Найти где формируется create-submit payload (~`handleSubmit` в TaskDrawer).
  - Добавить `delegateUserId` state.
  - Добавить компонент рядом с RalphModeSelect (если isInbox — определяется по prop projectName=undefined или явному `isInbox: boolean`).

- [ ] **Step 4:** Verify

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5:** Commit

```bash
git add client/src/presentation/components/tasks/QuickAddTodo.tsx \
        client/src/presentation/components/tasks/TaskDrawer.tsx \
        client/src/presentation/components/tasks/TaskListView.tsx \
        client/src/presentation/components/tasks/KanbanBoard.tsx
git commit -m "feat(client): DelegateSelect в формах создания inbox-задач"
```

---

### Task B15: интеграция DelegationBadge в TaskListRow + KanbanCard

**Files:**
- Modify: `client/src/presentation/components/tasks/TaskListView.tsx` (TaskListRow)
- Modify: `client/src/presentation/components/tasks/KanbanCard.tsx`

- [ ] **Step 1:** В TaskListRow — после блока `hasBadges` (если `task.delegation`) добавить:

```tsx
{task.delegation && currentUserId && (
  <DelegationBadge delegation={task.delegation} currentUserId={currentUserId} />
)}
```

Где `currentUserId` берётся через `useCurrentUser()` в TaskListView и прокидывается в Row.

- [ ] **Step 2:** Аналогично в KanbanCard.tsx.

- [ ] **Step 3:** Verify

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 4:** Commit

```bash
git add client/src/presentation/components/tasks/TaskListView.tsx \
        client/src/presentation/components/tasks/KanbanCard.tsx
git commit -m "feat(client): DelegationBadge на карточках inbox-задач"
```

---

### Task B16: PendingDelegationsBlock в InboxPage + AssignToProjectSelect в TaskDrawer (edit)

**Files:**
- Modify: `client/src/presentation/pages/InboxPage.tsx`
- Modify: `client/src/presentation/components/tasks/TaskDrawer.tsx`

- [ ] **Step 1:** В `InboxPage.tsx` — над KanbanBoard/TaskListView:

```tsx
import { PendingDelegationsBlock } from '@/presentation/components/tasks/PendingDelegationsBlock';
// ...
const [refetchTrigger, setRefetchTrigger] = useState(0);
// ...
return (
  <div className="flex h-full flex-col gap-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      ...header...
    </div>
    <p className="...">Задачи, которые ещё не привязаны к проекту...</p>

    <PendingDelegationsBlock onChanged={() => setRefetchTrigger((t) => t + 1)} />

    {view === 'kanban' ? (
      <KanbanBoard key={refetchTrigger} projectId={project.id} showCommits={false} hideDone={hideDone} />
    ) : (
      <TaskListView key={refetchTrigger} projectId={project.id} showCommits={false} hideDone={hideDone} />
    )}
  </div>
);
```

`key={refetchTrigger}` — простой способ форсить refetch (`useTasks` хук пересоздаётся). Альтернатива — exposed `refetch` через ref/event, но для MVP так короче.

- [ ] **Step 2:** В `TaskDrawer.tsx` (edit-mode только для inbox-задач) — в header'е рядом с титулом / chip'ом рендер:

```tsx
{state.mode === 'edit' && taskIsInInbox && (
  <AssignToProjectSelect
    task={state.task}
    onAssigned={() => { onCommitsChange?.(); onClose(); }}
  />
)}
```

Где `taskIsInInbox` — определяется через `state.task.projectId === inboxProjectId` (нужно прокинуть `inboxProjectId` prop'ом или из контейнера через `getInbox()`).

- [ ] **Step 3:** Verify

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 4:** Commit

```bash
git add client/src/presentation/pages/InboxPage.tsx \
        client/src/presentation/components/tasks/TaskDrawer.tsx
git commit -m "feat(client): PendingDelegationsBlock в InboxPage + AssignToProjectSelect в drawer"
```

---

### Task B17: NotificationsPage — handlers для трёх новых типов

**Files:**
- Modify: `client/src/presentation/pages/NotificationsPage.tsx`

- [ ] **Step 1:** В `NotificationRow` добавить блоки рендера для каждого нового типа:

```tsx
{payload.type === 'task_delegation' && (
  <>
    <p className="text-sm leading-snug">
      <span className="font-medium">{payload.actorDisplayName}</span> делегировал вам задачу:
    </p>
    <p className="line-clamp-2 text-xs italic text-muted-foreground">«{payload.taskExcerpt}»</p>
    <div className="flex gap-2 pt-1">
      <Button
        size="sm"
        className="bg-emerald-600 hover:bg-emerald-700"
        onClick={(e) => { e.stopPropagation(); onAcceptDelegation(); }}
      >
        Принять
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={(e) => { e.stopPropagation(); onDeclineDelegation(); }}
      >
        Отклонить
      </Button>
    </div>
  </>
)}

{payload.type === 'task_delegation_resolved' && (
  <p className="text-sm leading-snug">
    <span className="font-medium">{payload.delegateDisplayName}</span>{' '}
    {payload.resolution === 'accepted' ? 'принял' : 'отклонил'} вашу задачу:{' '}
    <span className="italic text-muted-foreground">«{payload.taskExcerpt}»</span>
  </p>
)}

{payload.type === 'task_assigned_to_project' && (
  <p className="text-sm leading-snug">
    <span className="font-medium">{payload.actorDisplayName}</span> перенёс делегированную вам задачу в{' '}
    <span className="font-medium">«{payload.projectName}»</span>.
  </p>
)}
```

- [ ] **Step 2:** Добавить handler'ы в NotificationsPage:

```tsx
const handleAcceptDelegation = async (n: Notification): Promise<void> => {
  if (n.payload.type !== 'task_delegation') return;
  try {
    await taskDelegationRepository.accept(n.payload.delegationId);
    await markRead(n);
    toast.success('Задача принята');
  } catch (e) {
    toast.error(`Не удалось: ${(e as Error).message}`);
  }
};

const handleDeclineDelegation = async (n: Notification): Promise<void> => {
  if (n.payload.type !== 'task_delegation') return;
  try {
    await taskDelegationRepository.decline(n.payload.delegationId);
    await markRead(n);
    toast.success('Задача отклонена');
  } catch (e) {
    toast.error(`Не удалось: ${(e as Error).message}`);
  }
};
```

И передать в NotificationRow.

- [ ] **Step 3:** Verify

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 4:** Commit

```bash
git add client/src/presentation/pages/NotificationsPage.tsx
git commit -m "feat(client): рендер 3 новых типов notifications (delegation, resolved, assigned)"
```

---

### Task B18: Финальный smoke в dev-сервере

- [ ] **Step 1:** Прогнать миграции (если ещё не):

```bash
npm run db:migrate
```

- [ ] **Step 2:** Запустить dev:

```bash
npm run dev
```

Это поднимет client (5173) и server (4317) параллельно.

- [ ] **Step 3:** Открыть `http://localhost:5173/inbox`. Smoke checklist:
  - [ ] Создать задачу без делегата → видна в списке. Чекбокс работает (✓/✗ optimistic, статус меняется).
  - [ ] Toggle «Скрыть выполненные» — done-задачи прячутся.
  - [ ] Из второго аккаунта (или в incognito → второй login) пригласить первого в общий проект → принять.
  - [ ] Первый аккаунт: создать в inbox задачу с делегированием второму. Проверить ярлык «Делегировано: Х (ожидает)».
  - [ ] Второй аккаунт: открыть `/inbox` — видит блок «Делегировано мне». Принять → задача появилась в его inbox с «От: Х».
  - [ ] Второй аккаунт: чекбокс. Первый — refetch'ит, видит done.
  - [ ] Второй аккаунт: создать второе делегирование, у второго → Отклонить → у первого notification «отклонил».
  - [ ] Первый: в TaskDrawer (edit для inbox-задачи) — селект «Перенести в проект». Выбрать → задача исчезает у обоих, у второго (если был accepted) — email + notification.
  - [ ] Notifications page: новые типы рендерятся.

- [ ] **Step 4:** Проверить console на ошибки — fix если есть.

- [ ] **Step 5:** Финальный коммит (если есть мелкие fix'ы по итогам smoke'а):

```bash
git add -A
git commit -m "fix(inbox): smoke test fixes"
```

---

## Self-review (выполнен по чеклисту writing-plans)

**1. Spec coverage:** Каждая секция spec'а есть в плане:
- Phase A чекбокс + hide-done → Task A1, A2.
- DB миграция + Drizzle → Task B1.
- Domain TaskDelegation → Task B2.
- Permissions helper → Task B3.
- TaskDelegationRepository → Task B4.
- ListTasks join → Task B5.
- ListSharedMembers → Task B6.
- Notification types + email → Task B7.
- CreateTask extension → Task B8.
- Accept/Decline/Withdraw/Pending/AssignToProject → Task B9.
- Authorization в существующих use-cases → Task B10.
- HTTP routes → Task B11.
- Client adapters + container → Task B12.
- UI компоненты → Task B13.
- Integration в форму создания → Task B14.
- DelegationBadge → Task B15.
- PendingDelegationsBlock + AssignToProjectSelect интеграция → Task B16.
- NotificationsPage → Task B17.
- Smoke → Task B18.

**2. Placeholder scan:** Несколько мест с «уточнить чтением файла» / «определяется через ...» — это намеренные lookups при имплементации (паттерн drizzle, project ownerId field name, http.ts wiring). Не placeholder'ы для логики — это «открой соседний файл-образец». Допустимо.

**3. Type consistency:** `TaskDelegation` shape единая. `CreateTaskInput.delegateUserId` — same name в client/server. `SharedMember` shape — `{id, displayName, email}` везде. `taskExcerpt` length=120 везде. ✓
