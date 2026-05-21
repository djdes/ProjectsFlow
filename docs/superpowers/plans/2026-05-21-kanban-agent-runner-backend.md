# Kanban Agent Runner — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять backend-инфраструктуру очереди agent-job'ов: схема БД, domain/application/infrastructure слои, HTTP endpoints + UI-кнопка «Отдать агенту» с бейджем статуса. После этого плана юзер кликает кнопку, видит job в `queued`, может отменить — но **runner ещё не подхватывает работу** (отдельный Plan B).

**Architecture:** Server-side — Clean Architecture в `server/` (domain → application → infrastructure → presentation). Новая таблица `agent_jobs` и колонка `tasks.delegated_to_agent` через append-only миграции (014, 015). Webhook + cancel + list endpoints под session-cookie auth с проверкой permissions через существующий `can(role, action)`. Client-side — расширяем `KanbanCard` через dropdown-menu item + new `AgentJobBadge` component, polling каждые 5с пока есть активные job'ы.

**Tech Stack:** Node.js 22 · Express 4 · Drizzle ORM · MariaDB 10.11 · React 19 · TypeScript 5 · shadcn/ui · `eslint-plugin-boundaries`.

**Spec:** [2026-05-21-kanban-agent-runner-design.md](../specs/2026-05-21-kanban-agent-runner-design.md)

**Зависит от:** Spec #5 (multi-tenant, project_members) — должен быть уже в проде.

**Не входит в этот план (Plan B):**
- Runner-процесс (claim loop, worktree, `claude -p` spawn, push, `gh pr create`).
- `HttpAgentRunnerSignal` ходит «в пустоту» — мы оставляем endpoint `/wake` неподнятым, signal просто логируется и игнорируется. Runner подключается в Plan B.
- Лог-просмотрщик и endpoint `/log` (поднимется когда есть что логировать).

**Testing note:** В проекте сейчас нет тестов (по образцу [KB plan](2026-05-15-kb-architecture.md)). Каждая задача завершается typecheck/lint + ручной smoke-тест. Тесты — отдельный план.

**Замечания по среде исполнения:**
- Корневая директория — `c:\www\ProjectsFlow`. Все пути в плане — относительно неё.
- Платформа — Windows + PowerShell. npm-скрипты работают cross-platform.
- Кириллица: UI-строки на русском, код/комменты/идентификаторы на английском.

---

## File Structure

### Server (new files)

```
server/src/
├── domain/agent/
│   ├── AgentJob.ts
│   └── (errors добавляем в существующий domain/agent/errors.ts)
├── application/agent/
│   ├── AgentJobRepository.ts        ← port
│   ├── AgentRunnerSignal.ts         ← port
│   ├── EnqueueAgentJob.ts
│   ├── CancelAgentJob.ts
│   └── ListAgentJobsForProject.ts
├── infrastructure/
│   ├── repositories/DrizzleAgentJobRepository.ts
│   └── agent/
│       ├── NoopAgentRunnerSignal.ts
│       └── HttpAgentRunnerSignal.ts
└── presentation/agent-jobs/
    ├── routes.ts
    └── schemas.ts
```

### Server (modified)

```
server/src/
├── domain/agent/errors.ts                          (add AgentJobNotFoundError, AgentJobNotCancellableError)
├── domain/project/permissions.ts                   (add 'delegate_task_to_agent', 'cancel_agent_job')
├── infrastructure/db/schema.ts                     (add agent_jobs table + tasks.delegated_to_agent)
├── presentation/tasks/routes.ts                    (extend GET list → include agentJob inline)
├── presentation/middleware/errorHandler.ts         (map new errors → HTTP status)
├── presentation/http.ts                            (wire agent-jobs router)
├── presentation/config.ts                          (add RUNNER_SIGNAL_URL + RUNNER_ENABLED)
└── index.ts                                        (wire new use-cases + signal)
```

### Client (new files)

```
client/src/
├── domain/agentJob/
│   └── AgentJob.ts
├── application/agentJob/
│   ├── AgentJobRepository.ts        ← port
│   ├── EnqueueAgentJob.ts
│   └── CancelAgentJob.ts
├── infrastructure/http/
│   └── HttpAgentJobRepository.ts
└── presentation/
    ├── components/tasks/
    │   ├── AgentJobBadge.tsx
    │   └── DelegateToAgentButton.tsx
    └── hooks/
        └── useAgentJobPolling.ts
```

### Client (modified)

```
client/src/
├── domain/task/Task.ts                             (add delegatedToAgent + agentJob fields)
├── infrastructure/http/HttpTaskRepository.ts       (parse new fields)
├── infrastructure/di/container.tsx                 (register HttpAgentJobRepository + use-cases)
├── presentation/components/tasks/KanbanCard.tsx    (add DelegateToAgentButton + AgentJobBadge)
└── presentation/components/tasks/KanbanBoard.tsx   (передача onDelegateToAgent + agentJob через props)
```

### Migrations

```
db/
├── 014_agent_jobs.sql
└── 015_task_delegated_to_agent.sql
```

### Env

```
.env.example                                        (add RUNNER_ENABLED, RUNNER_SIGNAL_URL)
```

---

## Phase 1: DB Schema + Domain + Permissions

Foundation — БД, типы, права. После этой фазы typecheck зелёный, ничего нового в runtime ещё не делает.

### Task 1.1: Миграция 014 — `agent_jobs`

**Files:**
- Create: `db/014_agent_jobs.sql`

- [ ] **Step 1: Создать файл миграции**

```sql
-- db/014_agent_jobs.sql
-- Очередь и история agent-job'ов для kanban-agent runner'а.
-- См. docs/superpowers/specs/2026-05-21-kanban-agent-runner-design.md

CREATE TABLE agent_jobs (
  id            CHAR(36)     NOT NULL,
  project_id    CHAR(36)     NOT NULL,
  task_id       CHAR(36)     NOT NULL,
  status        ENUM('queued','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempt       INT          NOT NULL DEFAULT 1,
  claimed_at    TIMESTAMP    NULL,
  started_at    TIMESTAMP    NULL,
  finished_at   TIMESTAMP    NULL,
  error         TEXT         NULL,
  pr_url        VARCHAR(500) NULL,
  branch_name   VARCHAR(200) NULL,
  runner_pid    INT          NULL,
  created_by    CHAR(36)     NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_jobs_status (status),
  KEY idx_agent_jobs_project_status (project_id, status),
  KEY idx_agent_jobs_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Применить миграцию**

```
npm run db:migrate
```

Expected: `Applied 014_agent_jobs.sql`. Если упадёт — проверь подключение к БД через `.env` (см. CLAUDE.md → «Переменные окружения»).

### Task 1.2: Миграция 015 — `tasks.delegated_to_agent`

**Files:**
- Create: `db/015_task_delegated_to_agent.sql`

- [ ] **Step 1: Создать файл миграции**

```sql
-- db/015_task_delegated_to_agent.sql
-- Sticky-флаг «отдано агенту». UI ориентируется на agent_jobs.status (активная job
-- = queued/running), но флаг полезен для будущей логики re-queue при failed.

ALTER TABLE tasks
  ADD COLUMN delegated_to_agent BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Применить миграцию**

```
npm run db:migrate
```

Expected: `Applied 015_task_delegated_to_agent.sql`.

### Task 1.3: Drizzle schema — `agentJobs` + `tasks.delegatedToAgent`

**Files:**
- Modify: `server/src/infrastructure/db/schema.ts`

- [ ] **Step 1: Добавить колонку в `tasks`**

Найди определение `tasks` (≈ строка 172) и добавь `delegatedToAgent`:

```ts
export const tasks = mysqlTable(
  'tasks',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    description: text('description'),
    status: mysqlEnum('status', ['backlog', 'todo', 'in_progress', 'done']).notNull().default('todo'),
    position: double('position').notNull().default(0),
    delegatedToAgent: boolean('delegated_to_agent').notNull().default(false),  // ← добавить
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  ...
);
```

- [ ] **Step 2: Добавить таблицу `agentJobs` в конец файла**

После определения `agentTokens` (≈ строка 265) добавь:

```ts
export const agentJobs = mysqlTable(
  'agent_jobs',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
      .notNull()
      .default('queued'),
    attempt: int('attempt').notNull().default(1),
    claimedAt: timestamp('claimed_at'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    error: text('error'),
    prUrl: varchar('pr_url', { length: 500 }),
    branchName: varchar('branch_name', { length: 200 }),
    runnerPid: int('runner_pid'),
    createdBy: char('created_by', { length: 36 }).notNull(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_agent_jobs_status').on(t.status),
    index('idx_agent_jobs_project_status').on(t.projectId, t.status),
    index('idx_agent_jobs_task').on(t.taskId),
  ],
);

export type AgentJobRow = typeof agentJobs.$inferSelect;
export type NewAgentJobRow = typeof agentJobs.$inferInsert;
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

Expected: green. Drizzle-схема в синхроне с БД.

### Task 1.4: Domain — `AgentJob` + extend `errors.ts`

**Files:**
- Create: `server/src/domain/agent/AgentJob.ts`
- Modify: `server/src/domain/agent/errors.ts`

- [ ] **Step 1: Создать entity + status type**

```ts
// server/src/domain/agent/AgentJob.ts
export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const AGENT_JOB_STATUSES: readonly AgentJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

export const ACTIVE_AGENT_JOB_STATUSES: readonly AgentJobStatus[] = ['queued', 'running'];

export type AgentJob = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly status: AgentJobStatus;
  readonly attempt: number;
  readonly claimedAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly error: string | null;
  readonly prUrl: string | null;
  readonly branchName: string | null;
  readonly runnerPid: number | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
```

- [ ] **Step 2: Добавить ошибки в существующий errors.ts**

Открой `server/src/domain/agent/errors.ts` и добавь после существующих классов:

```ts
export class AgentJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Agent job ${jobId} not found`);
    this.name = 'AgentJobNotFoundError';
  }
}

export class AgentJobNotCancellableError extends Error {
  constructor(jobId: string, currentStatus: string) {
    super(`Agent job ${jobId} cannot be cancelled — current status: ${currentStatus}`);
    this.name = 'AgentJobNotCancellableError';
  }
}

export class TaskAlreadyHasActiveAgentJobError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} already has an active agent job`);
    this.name = 'TaskAlreadyHasActiveAgentJobError';
  }
}

export class TaskMissingDescriptionError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} has no description — nothing to delegate to agent`);
    this.name = 'TaskMissingDescriptionError';
  }
}
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

### Task 1.5: Permissions — `delegate_task_to_agent` + `cancel_agent_job`

**Files:**
- Modify: `server/src/domain/project/permissions.ts`

- [ ] **Step 1: Расширить ProjectAction + REQUIRED_ROLE**

В типе `ProjectAction` добавить:

```ts
export type ProjectAction =
  | ...existing...
  | 'delegate_task_to_agent'
  | 'cancel_agent_job';
```

В `REQUIRED_ROLE`:

```ts
const REQUIRED_ROLE: Record<ProjectAction, ProjectRole> = {
  ...existing...,
  delegate_task_to_agent: 'editor',
  cancel_agent_job: 'editor',
};
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

TS-енам строгий — если забыл одно из ключей, упадёт.

### ⛳ Phase 1 checkpoint

- [ ] Commit:
  ```
  git add db/014_agent_jobs.sql db/015_task_delegated_to_agent.sql server/src/infrastructure/db/schema.ts server/src/domain/agent/AgentJob.ts server/src/domain/agent/errors.ts server/src/domain/project/permissions.ts
  git commit -m "$(cat <<'EOF'
  feat(agent): add agent_jobs schema + domain + permissions

  Phase 1 of kanban-agent-runner backend: миграции 014/015, drizzle-схема,
  AgentJob entity, новые permission-actions. Runtime пока ничего не делает.

  Refs: docs/superpowers/specs/2026-05-21-kanban-agent-runner-design.md

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 2: Application + Infrastructure

Use-cases + Drizzle-репо + signal-порт. После этой фазы можно вручную вызывать use-case через REPL и job'ы появятся в БД.

### Task 2.1: Port `AgentJobRepository`

**Files:**
- Create: `server/src/application/agent/AgentJobRepository.ts`

- [ ] **Step 1: Определить port**

```ts
// server/src/application/agent/AgentJobRepository.ts
import type { AgentJob, AgentJobStatus } from '../../domain/agent/AgentJob.js';

export type NewAgentJobInput = {
  projectId: string;
  taskId: string;
  createdBy: string;
};

export type CompleteAgentJobInput = {
  status: Extract<AgentJobStatus, 'succeeded' | 'failed'>;
  error?: string | null;
  prUrl?: string | null;
  branchName?: string | null;
};

export type AgentJobRepository = {
  create(input: NewAgentJobInput): Promise<AgentJob>;
  findById(id: string): Promise<AgentJob | null>;
  findActiveByTaskId(taskId: string): Promise<AgentJob | null>;
  /**
   * Все job'ы проекта, новые первыми. Limit для UI (≈50 хватит).
   */
  listForProject(projectId: string, limit: number): Promise<AgentJob[]>;
  /**
   * Map taskId → активная job (queued или running). Используется при загрузке
   * списка задач проекта чтобы не делать N+1 запросов. Активная job ровно одна
   * на task (uniqueness обеспечивается на уровне use-case'а enqueue).
   */
  findActiveByTaskIds(taskIds: readonly string[]): Promise<Map<string, AgentJob>>;
  /**
   * Атомарный claim — реализация в Plan B. В Plan A метод объявляем для полноты
   * порта, но не вызываем нигде.
   */
  claimNext(globalCap: number, runnerPid: number): Promise<AgentJob | null>;
  markStarted(id: string): Promise<void>;
  complete(id: string, result: CompleteAgentJobInput): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
};
```

### Task 2.2: Port `AgentRunnerSignal`

**Files:**
- Create: `server/src/application/agent/AgentRunnerSignal.ts`

- [ ] **Step 1: Определить port**

```ts
// server/src/application/agent/AgentRunnerSignal.ts
/**
 * Сигнал runner-процессу: «есть новая job, проснись и сделай claim».
 * В Plan A реализация — Noop (логирует и игнорирует). В Plan B — Http (POST на :4318/wake).
 */
export type AgentRunnerSignal = {
  notifyJobEnqueued(): Promise<void>;
};
```

### Task 2.3: Use-case `EnqueueAgentJob`

**Files:**
- Create: `server/src/application/agent/EnqueueAgentJob.ts`

- [ ] **Step 1: Реализация use-case**

```ts
// server/src/application/agent/EnqueueAgentJob.ts
import type { AgentJob } from '../../domain/agent/AgentJob.js';
import {
  TaskAlreadyHasActiveAgentJobError,
  TaskMissingDescriptionError,
} from '../../domain/agent/errors.js';
import {
  InsufficientRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';
import type { AgentRunnerSignal } from './AgentRunnerSignal.js';

export type EnqueueAgentJobInput = {
  userId: string;
  projectId: string;
  taskId: string;
};

export class EnqueueAgentJob {
  constructor(
    private readonly deps: {
      members: ProjectMemberRepository;
      tasks: TaskRepository;
      agentJobs: AgentJobRepository;
      signal: AgentRunnerSignal;
    },
  ) {}

  async execute(input: EnqueueAgentJobInput): Promise<AgentJob> {
    // 1. Permissions
    const membership = await this.deps.members.findForProject(input.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError(input.projectId);
    if (!can(membership.role, 'delegate_task_to_agent')) {
      throw new InsufficientRoleError(membership.role, 'delegate_task_to_agent');
    }

    // 2. Task существует и принадлежит проекту
    const task = await this.deps.tasks.findById(input.taskId);
    if (!task || task.projectId !== input.projectId) {
      throw new TaskNotFoundError(input.taskId);
    }
    if (!task.description || task.description.trim().length === 0) {
      throw new TaskMissingDescriptionError(input.taskId);
    }

    // 3. На task нет активной job
    const existing = await this.deps.agentJobs.findActiveByTaskId(input.taskId);
    if (existing) throw new TaskAlreadyHasActiveAgentJobError(input.taskId);

    // 4. Создаём job + ставим sticky-флаг на task
    await this.deps.tasks.setDelegatedToAgent(input.taskId, true);
    const job = await this.deps.agentJobs.create({
      projectId: input.projectId,
      taskId: input.taskId,
      createdBy: input.userId,
    });

    // 5. Будим runner (best-effort, в Plan A — noop)
    void this.deps.signal.notifyJobEnqueued().catch(() => {
      // Signal — оптимизация. Polling в Plan B всё равно подхватит.
    });

    return job;
  }
}
```

- [ ] **Step 2: Добавить `setDelegatedToAgent` в `TaskRepository` port**

Открой `server/src/application/task/TaskRepository.ts` и добавь метод:

```ts
export type TaskRepository = {
  ...existing methods...
  setDelegatedToAgent(taskId: string, value: boolean): Promise<void>;
};
```

- [ ] **Step 3: Реализовать метод в `DrizzleTaskRepository`**

Открой `server/src/infrastructure/repositories/DrizzleTaskRepository.ts` и добавь:

```ts
async setDelegatedToAgent(taskId: string, value: boolean): Promise<void> {
  await this.db
    .update(tasks)
    .set({ delegatedToAgent: value })
    .where(eq(tasks.id, taskId));
}
```

(импорт `tasks` и `eq` уже должны быть в файле — иначе добавь)

- [ ] **Step 4: Typecheck**

```
npm run typecheck
```

### Task 2.4: Use-case `CancelAgentJob`

**Files:**
- Create: `server/src/application/agent/CancelAgentJob.ts`

- [ ] **Step 1: Реализация**

```ts
// server/src/application/agent/CancelAgentJob.ts
import {
  AgentJobNotCancellableError,
  AgentJobNotFoundError,
} from '../../domain/agent/errors.js';
import {
  InsufficientRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';

export type CancelAgentJobInput = {
  userId: string;
  projectId: string;
  jobId: string;
  reason?: string;
};

export class CancelAgentJob {
  constructor(
    private readonly deps: {
      members: ProjectMemberRepository;
      agentJobs: AgentJobRepository;
    },
  ) {}

  async execute(input: CancelAgentJobInput): Promise<void> {
    const membership = await this.deps.members.findForProject(input.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError(input.projectId);
    if (!can(membership.role, 'cancel_agent_job')) {
      throw new InsufficientRoleError(membership.role, 'cancel_agent_job');
    }

    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job || job.projectId !== input.projectId) {
      throw new AgentJobNotFoundError(input.jobId);
    }
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      throw new AgentJobNotCancellableError(input.jobId, job.status);
    }

    // queued → просто помечаем; running → в Plan B будет signal на runner для SIGTERM.
    // В Plan A мы реализуем только пометку; runner ещё не существует.
    await this.deps.agentJobs.cancel(input.jobId, input.reason ?? 'cancelled by user');
  }
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

### Task 2.5: Use-case `ListAgentJobsForProject`

**Files:**
- Create: `server/src/application/agent/ListAgentJobsForProject.ts`

- [ ] **Step 1: Реализация**

```ts
// server/src/application/agent/ListAgentJobsForProject.ts
import type { AgentJob } from '../../domain/agent/AgentJob.js';
import { InsufficientRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';

const DEFAULT_LIMIT = 50;

export class ListAgentJobsForProject {
  constructor(
    private readonly deps: {
      members: ProjectMemberRepository;
      agentJobs: AgentJobRepository;
    },
  ) {}

  async execute(input: { userId: string; projectId: string }): Promise<AgentJob[]> {
    const membership = await this.deps.members.findForProject(input.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError(input.projectId);
    if (!can(membership.role, 'read_project')) {
      throw new InsufficientRoleError(membership.role, 'read_project');
    }
    return this.deps.agentJobs.listForProject(input.projectId, DEFAULT_LIMIT);
  }
}
```

### Task 2.6: Infrastructure — `DrizzleAgentJobRepository`

**Files:**
- Create: `server/src/infrastructure/repositories/DrizzleAgentJobRepository.ts`

- [ ] **Step 1: Реализация**

```ts
// server/src/infrastructure/repositories/DrizzleAgentJobRepository.ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { AgentJob, AgentJobStatus } from '../../domain/agent/AgentJob.js';
import type {
  AgentJobRepository,
  CompleteAgentJobInput,
  NewAgentJobInput,
} from '../../application/agent/AgentJobRepository.js';
import { ACTIVE_AGENT_JOB_STATUSES } from '../../domain/agent/AgentJob.js';
import { generateId } from '../id/idGenerator.js';
import { agentJobs, type AgentJobRow } from '../db/schema.js';

export class DrizzleAgentJobRepository implements AgentJobRepository {
  constructor(private readonly db: MySql2Database<Record<string, unknown>>) {}

  async create(input: NewAgentJobInput): Promise<AgentJob> {
    const id = generateId();
    await this.db.insert(agentJobs).values({
      id,
      projectId: input.projectId,
      taskId: input.taskId,
      createdBy: input.createdBy,
      status: 'queued',
    });
    const row = await this.requireRow(id);
    return rowToJob(row);
  }

  async findById(id: string): Promise<AgentJob | null> {
    const [row] = await this.db.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1);
    return row ? rowToJob(row) : null;
  }

  async findActiveByTaskId(taskId: string): Promise<AgentJob | null> {
    const rows = await this.db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.taskId, taskId),
          inArray(agentJobs.status, [...ACTIVE_AGENT_JOB_STATUSES] as AgentJobStatus[]),
        ),
      )
      .limit(1);
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async findActiveByTaskIds(taskIds: readonly string[]): Promise<Map<string, AgentJob>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(agentJobs)
      .where(
        and(
          inArray(agentJobs.taskId, [...taskIds]),
          inArray(agentJobs.status, [...ACTIVE_AGENT_JOB_STATUSES] as AgentJobStatus[]),
        ),
      );
    const result = new Map<string, AgentJob>();
    for (const row of rows) result.set(row.taskId, rowToJob(row));
    return result;
  }

  async listForProject(projectId: string, limit: number): Promise<AgentJob[]> {
    const rows = await this.db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.projectId, projectId))
      .orderBy(desc(agentJobs.createdAt))
      .limit(limit);
    return rows.map(rowToJob);
  }

  // ↓ методы используются runner'ом в Plan B. В Plan A — пустые stub'ы с правильной сигнатурой.

  async claimNext(): Promise<AgentJob | null> {
    // TODO Plan B: SELECT ... FOR UPDATE SKIP LOCKED + check global cap + per-project mutex
    return null;
  }

  async markStarted(id: string): Promise<void> {
    await this.db
      .update(agentJobs)
      .set({ startedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(agentJobs.id, id));
  }

  async complete(id: string, result: CompleteAgentJobInput): Promise<void> {
    await this.db
      .update(agentJobs)
      .set({
        status: result.status,
        finishedAt: sql`CURRENT_TIMESTAMP`,
        error: result.error ?? null,
        prUrl: result.prUrl ?? null,
        branchName: result.branchName ?? null,
      })
      .where(eq(agentJobs.id, id));
  }

  async cancel(id: string, reason: string): Promise<void> {
    await this.db
      .update(agentJobs)
      .set({
        status: 'cancelled',
        finishedAt: sql`CURRENT_TIMESTAMP`,
        error: reason,
      })
      .where(eq(agentJobs.id, id));
  }

  private async requireRow(id: string): Promise<AgentJobRow> {
    const [row] = await this.db.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1);
    if (!row) throw new Error(`agent_jobs row ${id} disappeared after insert`);
    return row;
  }
}

function rowToJob(row: AgentJobRow): AgentJob {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    status: row.status,
    attempt: row.attempt,
    claimedAt: row.claimedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    prUrl: row.prUrl,
    branchName: row.branchName,
    runnerPid: row.runnerPid,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

### Task 2.7: Infrastructure — Signal-реализации

**Files:**
- Create: `server/src/infrastructure/agent/NoopAgentRunnerSignal.ts`
- Create: `server/src/infrastructure/agent/HttpAgentRunnerSignal.ts`

- [ ] **Step 1: Noop**

```ts
// server/src/infrastructure/agent/NoopAgentRunnerSignal.ts
import type { AgentRunnerSignal } from '../../application/agent/AgentRunnerSignal.js';

/** Используется когда RUNNER_ENABLED=false. */
export class NoopAgentRunnerSignal implements AgentRunnerSignal {
  async notifyJobEnqueued(): Promise<void> {
    // intentional no-op
  }
}
```

- [ ] **Step 2: Http**

```ts
// server/src/infrastructure/agent/HttpAgentRunnerSignal.ts
import type { AgentRunnerSignal } from '../../application/agent/AgentRunnerSignal.js';

/**
 * POST на /wake локального runner'а. В Plan A endpoint никем не поднят —
 * AbortController с коротким timeout'ом гарантирует, что enqueue не виснет.
 */
export class HttpAgentRunnerSignal implements AgentRunnerSignal {
  constructor(private readonly signalUrl: string) {}

  async notifyJobEnqueued(): Promise<void> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    try {
      await fetch(`${this.signalUrl}/wake`, { method: 'POST', signal: ctrl.signal });
    } catch {
      // Best-effort. Runner поднимется через polling в Plan B.
    } finally {
      clearTimeout(t);
    }
  }
}
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

### ⛳ Phase 2 checkpoint

- [ ] Commit:
  ```
  git add server/src/application/agent server/src/infrastructure/repositories/DrizzleAgentJobRepository.ts server/src/infrastructure/agent server/src/application/task/TaskRepository.ts server/src/infrastructure/repositories/DrizzleTaskRepository.ts
  git commit -m "$(cat <<'EOF'
  feat(agent): application layer + drizzle repo для agent_jobs

  Phase 2 of kanban-agent-runner backend: ports AgentJobRepository +
  AgentRunnerSignal, use-cases Enqueue/Cancel/List, DrizzleAgentJobRepository,
  Noop + Http signal-реализации. Runner-методы (claim*) — stub'ы под Plan B.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 3: HTTP Endpoints + Config Wiring

Webhook, cancel, list endpoints + расширение existing /tasks. После этой фазы можно через curl создать job, увидеть его, отменить.

### Task 3.1: Env vars + config

**Files:**
- Modify: `.env.example`
- Modify: `server/src/presentation/config.ts`

- [ ] **Step 1: `.env.example`**

Добавь в конец:

```bash
# === Kanban Agent Runner (Plan B activates this) ===
# RUNNER_ENABLED=false означает что enqueue работает, но signal/wake — noop.
# В Plan B сюда добавляются ANTHROPIC_API_KEY, GH_TOKEN и т.д.
RUNNER_ENABLED=false
RUNNER_SIGNAL_URL=http://127.0.0.1:4318
```

- [ ] **Step 2: `config.ts`**

Найди `Config` type и добавь поля:

```ts
export type Config = {
  ...existing fields...
  runnerEnabled: boolean;
  runnerSignalUrl: string;
};

export function loadConfig(): Config {
  return {
    ...existing...,
    runnerEnabled: process.env.RUNNER_ENABLED === 'true',
    runnerSignalUrl: process.env.RUNNER_SIGNAL_URL ?? 'http://127.0.0.1:4318',
  };
}
```

### Task 3.2: Wire в `index.ts`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Создать репо + signal + use-cases**

Найди секцию где создаются другие use-cases и добавь:

```ts
import { DrizzleAgentJobRepository } from './infrastructure/repositories/DrizzleAgentJobRepository.js';
import { NoopAgentRunnerSignal } from './infrastructure/agent/NoopAgentRunnerSignal.js';
import { HttpAgentRunnerSignal } from './infrastructure/agent/HttpAgentRunnerSignal.js';
import { EnqueueAgentJob } from './application/agent/EnqueueAgentJob.js';
import { CancelAgentJob } from './application/agent/CancelAgentJob.js';
import { ListAgentJobsForProject } from './application/agent/ListAgentJobsForProject.js';

// ... после создания других repository'ев:
const agentJobRepository = new DrizzleAgentJobRepository(db);
const agentRunnerSignal = config.runnerEnabled
  ? new HttpAgentRunnerSignal(config.runnerSignalUrl)
  : new NoopAgentRunnerSignal();

const enqueueAgentJob = new EnqueueAgentJob({
  members: projectMemberRepository,
  tasks: taskRepository,
  agentJobs: agentJobRepository,
  signal: agentRunnerSignal,
});
const cancelAgentJob = new CancelAgentJob({
  members: projectMemberRepository,
  agentJobs: agentJobRepository,
});
const listAgentJobsForProject = new ListAgentJobsForProject({
  members: projectMemberRepository,
  agentJobs: agentJobRepository,
});
```

(имена `projectMemberRepository`, `taskRepository`, `db` — как уже в файле; если другие — подгони)

- [ ] **Step 2: Передать в http-сборку**

В вызов `buildHttp({...})` (или как там называется главный сборщик) добавь новые use-cases.

### Task 3.3: HTTP schemas

**Files:**
- Create: `server/src/presentation/agent-jobs/schemas.ts`

- [ ] **Step 1: Zod-схемы**

```ts
// server/src/presentation/agent-jobs/schemas.ts
import { z } from 'zod';

export const cancelAgentJobBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelAgentJobBody = z.infer<typeof cancelAgentJobBodySchema>;
```

(POST /agent имеет пустое body — params projectId + taskId уже в URL)

### Task 3.4: HTTP routes

**Files:**
- Create: `server/src/presentation/agent-jobs/routes.ts`

- [ ] **Step 1: Роутер**

```ts
// server/src/presentation/agent-jobs/routes.ts
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { EnqueueAgentJob } from '../../application/agent/EnqueueAgentJob.js';
import type { CancelAgentJob } from '../../application/agent/CancelAgentJob.js';
import type { ListAgentJobsForProject } from '../../application/agent/ListAgentJobsForProject.js';
import { requireSession } from '../middleware/requireAuth.js';
import { cancelAgentJobBodySchema } from './schemas.js';
import type { AgentJob } from '../../domain/agent/AgentJob.js';

type Deps = {
  enqueueAgentJob: EnqueueAgentJob;
  cancelAgentJob: CancelAgentJob;
  listAgentJobsForProject: ListAgentJobsForProject;
};

function jobToDto(j: AgentJob) {
  return {
    ...j,
    claimedAt: j.claimedAt?.toISOString() ?? null,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

export function buildAgentJobsRouter(deps: Deps): Router {
  const r = Router({ mergeParams: true });

  // POST /api/projects/:projectId/tasks/:taskId/agent
  r.post(
    '/projects/:projectId/tasks/:taskId/agent',
    requireSession,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const job = await deps.enqueueAgentJob.execute({
          userId: req.session!.userId,
          projectId: req.params.projectId!,
          taskId: req.params.taskId!,
        });
        res.status(201).json({ job: jobToDto(job) });
      } catch (e) {
        next(e);
      }
    },
  );

  // DELETE /api/projects/:projectId/agent-jobs/:jobId
  r.delete(
    '/projects/:projectId/agent-jobs/:jobId',
    requireSession,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = cancelAgentJobBodySchema.parse(req.body ?? {});
        await deps.cancelAgentJob.execute({
          userId: req.session!.userId,
          projectId: req.params.projectId!,
          jobId: req.params.jobId!,
          reason: body.reason,
        });
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // GET /api/projects/:projectId/agent-jobs
  r.get(
    '/projects/:projectId/agent-jobs',
    requireSession,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jobs = await deps.listAgentJobsForProject.execute({
          userId: req.session!.userId,
          projectId: req.params.projectId!,
        });
        res.json({ jobs: jobs.map(jobToDto) });
      } catch (e) {
        next(e);
      }
    },
  );

  return r;
}
```

### Task 3.5: Errors → HTTP statuses

**Files:**
- Modify: `server/src/presentation/middleware/errorHandler.ts`

- [ ] **Step 1: Маппинг новых ошибок**

Найди существующий error-handler и добавь ветки для:

```ts
import {
  AgentJobNotFoundError,
  AgentJobNotCancellableError,
  TaskAlreadyHasActiveAgentJobError,
  TaskMissingDescriptionError,
} from '../../domain/agent/errors.js';

// внутри обработчика:
if (err instanceof AgentJobNotFoundError) {
  return res.status(404).json({ error: 'agent_job_not_found', message: err.message });
}
if (err instanceof AgentJobNotCancellableError) {
  return res.status(409).json({ error: 'agent_job_not_cancellable', message: err.message });
}
if (err instanceof TaskAlreadyHasActiveAgentJobError) {
  return res.status(409).json({ error: 'task_has_active_agent_job', message: err.message });
}
if (err instanceof TaskMissingDescriptionError) {
  return res.status(400).json({ error: 'task_missing_description', message: err.message });
}
```

### Task 3.6: Wire router в `http.ts`

**Files:**
- Modify: `server/src/presentation/http.ts`

- [ ] **Step 1: Регистрация**

В `buildHttp` (или эквиваленте) добавь:

```ts
import { buildAgentJobsRouter } from './agent-jobs/routes.js';

// ...
const agentJobsRouter = buildAgentJobsRouter({
  enqueueAgentJob: deps.enqueueAgentJob,
  cancelAgentJob: deps.cancelAgentJob,
  listAgentJobsForProject: deps.listAgentJobsForProject,
});
app.use('/api', agentJobsRouter);
```

`Deps` type в `buildHttp` тоже расширь — добавь три новых поля.

### Task 3.7: Extend GET /tasks — inline agentJob

**Files:**
- Modify: `server/src/presentation/tasks/routes.ts`

- [ ] **Step 1: Найти handler `GET /api/projects/:projectId/tasks`**

В обработчике после получения списка задач — fetch активных job'ов:

```ts
import type { AgentJobRepository } from '../../application/agent/AgentJobRepository.js';

// Deps type:
type TasksRouterDeps = {
  ...existing...,
  agentJobs: AgentJobRepository;
};

// внутри handler'а GET:
const tasks = await listTasks.execute({ ... });
const activeJobs = await deps.agentJobs.findActiveByTaskIds(tasks.map((t) => t.id));

res.json({
  tasks: tasks.map((t) => ({
    ...taskToDto(t),
    delegatedToAgent: t.delegatedToAgent,
    agentJob: activeJobs.get(t.id) ? jobToDto(activeJobs.get(t.id)!) : null,
  })),
});
```

`jobToDto` — импорт из `../agent-jobs/routes.ts` либо вынести в shared helper.

- [ ] **Step 2: Передать `agentJobs` в `buildTasksRouter` из `http.ts`**

### Task 3.8: Расширить Task domain на сервере

**Files:**
- Modify: `server/src/domain/task/Task.ts`

- [ ] **Step 1: Добавить поле**

```ts
export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly position: number;
  readonly delegatedToAgent: boolean;     // ← добавить
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
```

- [ ] **Step 2: Обновить `DrizzleTaskRepository` маппинг**

В `rowToTask`/маппинг-функции добавь `delegatedToAgent: row.delegatedToAgent`.

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

### ⛳ Phase 3 checkpoint

- [ ] **Smoke test (через curl)**

Запусти сервер: `npm run dev:server`. Возьми любой `projectId` и `taskId` из БД (или из UI). Залогинься (cookie в браузере) — скопируй `sid` cookie.

```bash
# Enqueue
curl -i -X POST http://localhost:4317/api/projects/<PID>/tasks/<TID>/agent \
  -H "Cookie: sid=<SID>"
# Ожидается 201 + job{id, status: 'queued'}

# List
curl -s http://localhost:4317/api/projects/<PID>/agent-jobs \
  -H "Cookie: sid=<SID>" | jq

# Tasks endpoint теперь возвращает agentJob inline
curl -s http://localhost:4317/api/projects/<PID>/tasks \
  -H "Cookie: sid=<SID>" | jq '.tasks[] | select(.id=="<TID>")'

# Cancel
curl -i -X DELETE http://localhost:4317/api/projects/<PID>/agent-jobs/<JID> \
  -H "Cookie: sid=<SID>"
# Ожидается 204

# Повторный enqueue после cancel — должен сработать (cancelled не = active)
```

- [ ] Commit:
  ```
  git add server/src/presentation/agent-jobs server/src/presentation/http.ts server/src/presentation/tasks/routes.ts server/src/presentation/middleware/errorHandler.ts server/src/presentation/config.ts server/src/index.ts server/src/domain/task/Task.ts server/src/infrastructure/repositories/DrizzleTaskRepository.ts .env.example
  git commit -m "$(cat <<'EOF'
  feat(agent): HTTP endpoints для enqueue/cancel/list + inline agentJob в /tasks

  Phase 3 of kanban-agent-runner backend: agent-jobs router (POST enqueue,
  DELETE cancel, GET list), расширение /tasks (delegatedToAgent + agentJob),
  config + .env.example добавлены RUNNER_ENABLED + RUNNER_SIGNAL_URL.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 4: Client — Domain, HTTP, UI

UI-кнопка + бейдж + polling. После этой фазы весь flow работает в браузере (job создаётся, отображается, отменяется), но execution всё ещё не происходит.

### Task 4.1: Client domain — `AgentJob`

**Files:**
- Create: `client/src/domain/agentJob/AgentJob.ts`

- [ ] **Step 1: Создать тип**

```ts
// client/src/domain/agentJob/AgentJob.ts
export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const ACTIVE_AGENT_JOB_STATUSES: readonly AgentJobStatus[] = ['queued', 'running'];

export function isActiveAgentJobStatus(s: AgentJobStatus): boolean {
  return s === 'queued' || s === 'running';
}

export type AgentJob = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly status: AgentJobStatus;
  readonly attempt: number;
  readonly claimedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly prUrl: string | null;
  readonly branchName: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};
```

(Даты как ISO-строки — клиент не парсит, рендерит как есть.)

### Task 4.2: Client port + use-cases

**Files:**
- Create: `client/src/application/agentJob/AgentJobRepository.ts`
- Create: `client/src/application/agentJob/EnqueueAgentJob.ts`
- Create: `client/src/application/agentJob/CancelAgentJob.ts`

- [ ] **Step 1: Port**

```ts
// client/src/application/agentJob/AgentJobRepository.ts
import type { AgentJob } from '../../domain/agentJob/AgentJob.js';

export type AgentJobRepository = {
  enqueue(projectId: string, taskId: string): Promise<AgentJob>;
  cancel(projectId: string, jobId: string, reason?: string): Promise<void>;
};
```

- [ ] **Step 2: Use-cases (тонкие враппинги, follow project pattern)**

```ts
// client/src/application/agentJob/EnqueueAgentJob.ts
import type { AgentJobRepository } from './AgentJobRepository';
import type { AgentJob } from '../../domain/agentJob/AgentJob';

export class EnqueueAgentJob {
  constructor(private readonly repo: AgentJobRepository) {}
  async execute(projectId: string, taskId: string): Promise<AgentJob> {
    return this.repo.enqueue(projectId, taskId);
  }
}
```

```ts
// client/src/application/agentJob/CancelAgentJob.ts
import type { AgentJobRepository } from './AgentJobRepository';

export class CancelAgentJob {
  constructor(private readonly repo: AgentJobRepository) {}
  async execute(projectId: string, jobId: string, reason?: string): Promise<void> {
    return this.repo.cancel(projectId, jobId, reason);
  }
}
```

### Task 4.3: Client domain — расширить Task

**Files:**
- Modify: `client/src/domain/task/Task.ts`

- [ ] **Step 1: Добавить поля**

```ts
import type { AgentJob } from '../agentJob/AgentJob';

export type Task = {
  // ...existing...
  readonly delegatedToAgent: boolean;
  readonly agentJob: AgentJob | null;
};
```

### Task 4.4: Client HTTP — `HttpAgentJobRepository`

**Files:**
- Create: `client/src/infrastructure/http/HttpAgentJobRepository.ts`

- [ ] **Step 1: Реализация**

```ts
// client/src/infrastructure/http/HttpAgentJobRepository.ts
import type { AgentJobRepository } from '../../application/agentJob/AgentJobRepository';
import type { AgentJob } from '../../domain/agentJob/AgentJob';

export class HttpAgentJobRepository implements AgentJobRepository {
  async enqueue(projectId: string, taskId: string): Promise<AgentJob> {
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}/agent`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw await asError(res);
    const body = (await res.json()) as { job: AgentJob };
    return body.job;
  }

  async cancel(projectId: string, jobId: string, reason?: string): Promise<void> {
    const res = await fetch(`/api/projects/${projectId}/agent-jobs/${jobId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: reason ? { 'Content-Type': 'application/json' } : undefined,
      body: reason ? JSON.stringify({ reason }) : undefined,
    });
    if (!res.ok) throw await asError(res);
  }
}

async function asError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  } catch {
    return new Error(`HTTP ${res.status}`);
  }
}
```

### Task 4.5: Расширить `HttpTaskRepository`

**Files:**
- Modify: `client/src/infrastructure/http/HttpTaskRepository.ts`

- [ ] **Step 1: Парсить новые поля**

Если используется `JSON.parse` напрямую — поля `delegatedToAgent` и `agentJob` пройдут как есть. Если есть явное маппинг-преобразование `rowToTask`/`apiToTask` — добавь там:

```ts
function apiToTask(r: ApiTask): Task {
  return {
    ...existing fields...,
    delegatedToAgent: r.delegatedToAgent ?? false,
    agentJob: r.agentJob ?? null,
  };
}
```

(Поищи `Task` маппинг в этом файле — обычно одна функция.)

### Task 4.6: DI container

**Files:**
- Modify: `client/src/infrastructure/di/container.tsx`

- [ ] **Step 1: Зарегистрировать**

В блок где создаются другие репо/use-case'ы добавь:

```ts
import { HttpAgentJobRepository } from '@/infrastructure/http/HttpAgentJobRepository';
import { EnqueueAgentJob } from '@/application/agentJob/EnqueueAgentJob';
import { CancelAgentJob } from '@/application/agentJob/CancelAgentJob';

// внутри create:
const agentJobRepository = new HttpAgentJobRepository();
const enqueueAgentJob = new EnqueueAgentJob(agentJobRepository);
const cancelAgentJob = new CancelAgentJob(agentJobRepository);

// в Container value:
{
  ...existing,
  enqueueAgentJob,
  cancelAgentJob,
}
```

И расширь тип `Container` соответственно.

### Task 4.7: `AgentJobBadge` component

**Files:**
- Create: `client/src/presentation/components/tasks/AgentJobBadge.tsx`

- [ ] **Step 1: Компонент**

```tsx
// client/src/presentation/components/tasks/AgentJobBadge.tsx
import { useContainer } from '@/infrastructure/di/container';
import type { AgentJob } from '@/domain/agentJob/AgentJob';
import { Bot } from 'lucide-react';
import { useState } from 'react';

type Props = {
  job: AgentJob;
  projectId: string;
  onChanged: () => void;
};

const STATUS_TEXT: Record<AgentJob['status'], string> = {
  queued: 'В очереди',
  running: 'Работает',
  succeeded: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено',
};

const STATUS_CLASS: Record<AgentJob['status'], string> = {
  queued: 'bg-slate-100 text-slate-700 border-slate-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  succeeded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200',
};

export function AgentJobBadge({ job, projectId, onChanged }: Props) {
  const { cancelAgentJob } = useContainer();
  const [busy, setBusy] = useState(false);

  const canCancel = job.status === 'queued' || job.status === 'running';

  async function handleCancel(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await cancelAgentJob.execute(projectId, job.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${STATUS_CLASS[job.status]}`}
    >
      <Bot className="h-3 w-3" />
      <span>{STATUS_TEXT[job.status]}</span>
      {job.status === 'succeeded' && job.prUrl && (
        <a
          href={job.prUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="underline hover:text-emerald-900"
        >
          PR
        </a>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="ml-1 opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
          title="Отменить"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

### Task 4.8: `DelegateToAgentButton` (menu-item)

**Files:**
- Create: `client/src/presentation/components/tasks/DelegateToAgentButton.tsx`

- [ ] **Step 1: Компонент**

```tsx
// client/src/presentation/components/tasks/DelegateToAgentButton.tsx
import { useContainer } from '@/infrastructure/di/container';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Bot } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

type Props = {
  projectId: string;
  taskId: string;
  hasDescription: boolean;
  onEnqueued: () => void;
};

export function DelegateToAgentButton({ projectId, taskId, hasDescription, onEnqueued }: Props) {
  const { enqueueAgentJob } = useContainer();
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy || !hasDescription) return;
    setBusy(true);
    try {
      await enqueueAgentJob.execute(projectId, taskId);
      toast.success('Задача отдана агенту');
      onEnqueued();
    } catch (err) {
      toast.error('Не удалось отдать агенту', { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenuItem
      onClick={handleClick}
      disabled={busy || !hasDescription}
      className="gap-2"
    >
      <Bot className="h-4 w-4" />
      Отдать агенту
      {!hasDescription && <span className="ml-auto text-xs text-slate-400">нет описания</span>}
    </DropdownMenuItem>
  );
}
```

### Task 4.9: Интеграция в `KanbanCard`

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanCard.tsx`

- [ ] **Step 1: Импорты**

```tsx
import { AgentJobBadge } from './AgentJobBadge';
import { DelegateToAgentButton } from './DelegateToAgentButton';
```

- [ ] **Step 2: Menu item**

Найди существующий `DropdownMenu` в карточке (у других задач уже есть «Удалить» и т.д.) и добавь пункт **только для TODO + если нет активной job**:

```tsx
{task.status === 'todo' && (!task.agentJob || task.agentJob.status === 'failed' || task.agentJob.status === 'cancelled') && (
  <DelegateToAgentButton
    projectId={task.projectId}
    taskId={task.id}
    hasDescription={Boolean(task.description?.trim())}
    onEnqueued={onTaskChanged}
  />
)}
```

`onTaskChanged` — проп карточки, который и так уже зовётся при изменениях (если нет — пробросить из KanbanColumn → KanbanBoard).

- [ ] **Step 3: Бейдж**

В разметке карточки, под описанием, добавь:

```tsx
{task.agentJob && (
  <div className="mt-2">
    <AgentJobBadge
      job={task.agentJob}
      projectId={task.projectId}
      onChanged={onTaskChanged}
    />
  </div>
)}
```

### Task 4.10: Polling — `useAgentJobPolling`

**Files:**
- Create: `client/src/presentation/hooks/useAgentJobPolling.ts`

- [ ] **Step 1: Хук**

```ts
// client/src/presentation/hooks/useAgentJobPolling.ts
import { useEffect } from 'react';
import type { Task } from '@/domain/task/Task';
import { isActiveAgentJobStatus } from '@/domain/agentJob/AgentJob';

const POLL_INTERVAL_MS = 5000;

/**
 * Запускает периодический refetch tasks-списка пока есть task'и с активной agent-job.
 * Когда ни одного active — таймер выключается.
 */
export function useAgentJobPolling(tasks: readonly Task[], refetch: () => void): void {
  useEffect(() => {
    const hasActive = tasks.some(
      (t) => t.agentJob && isActiveAgentJobStatus(t.agentJob.status),
    );
    if (!hasActive) return;
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [tasks, refetch]);
}
```

- [ ] **Step 2: Подключить в `useTasks` (или там где грузятся tasks для канбана)**

Найди хук, который грузит tasks для проекта (вероятно `useTasks` в `presentation/hooks/`). После получения данных вызови `useAgentJobPolling(tasks, refetch)`.

Если у `useTasks` нет публичного `refetch` — добавь его (возвращай вместе с данными).

### Task 4.11: Lint + typecheck

- [ ] **Step 1: Из корня:**

```
npm run typecheck
npm run lint
```

Если eslint-boundaries падает с «Dependency not allowed» — значит где-то presentation импортирует из infrastructure напрямую (см. CLAUDE.md → Правила #2). Должен ходить только через `useContainer()`.

### ⛳ Phase 4 checkpoint

- [ ] **Smoke test (UI)**

```
npm run dev
```

Открой `http://localhost:5173/projects/<любой>`. На любой TODO-карточке открой меню (троеточие). Если задача БЕЗ описания — пункт «Отдать агенту» disabled с подписью «нет описания». Если С описанием — клик создаёт job, на карточке появляется серый бейдж «🤖 В очереди» с крестиком. Клик по крестику отменяет job — бейдж пропадает (или меняется на «Отменено», в зависимости от того, попадает ли cancelled в active filter). Refresh страницы → состояние сохраняется.

- [ ] Commit:
  ```
  git add client/src/domain/agentJob client/src/application/agentJob client/src/infrastructure/http/HttpAgentJobRepository.ts client/src/domain/task/Task.ts client/src/infrastructure/http/HttpTaskRepository.ts client/src/infrastructure/di/container.tsx client/src/presentation/components/tasks/AgentJobBadge.tsx client/src/presentation/components/tasks/DelegateToAgentButton.tsx client/src/presentation/components/tasks/KanbanCard.tsx client/src/presentation/hooks/useAgentJobPolling.ts
  git commit -m "$(cat <<'EOF'
  feat(agent): UI «Отдать агенту» + AgentJobBadge + polling

  Phase 4 of kanban-agent-runner backend: domain/application слои на клиенте,
  HttpAgentJobRepository, кнопка в KanbanCard для TODO-задач, бейдж статуса
  с возможностью отмены, polling tasks-списка раз в 5s пока есть активные job'ы.

  После этого Plan A полностью функционален — job'ы создаются, отображаются,
  отменяются. Execution (Plan B) пока не подключён — job'ы висят в queued.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 5: End-to-end Verification

Финальная проверка что весь flow работает, плюс sync с kanban-задачей через MCP.

### Task 5.1: Full e2e walkthrough

- [ ] **Step 1: Сценарий 1 — happy path**

  1. Создай задачу в TODO с описанием.
  2. Меню → «Отдать агенту».
  3. На карточке появляется серый бейдж «🤖 В очереди».
  4. Refresh страницы — бейдж сохраняется.
  5. В БД: `SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT 1;` — есть строка со status='queued'.
  6. В БД: `SELECT delegated_to_agent FROM tasks WHERE id=…;` — TRUE.

- [ ] **Step 2: Сценарий 2 — cancel**

  1. Клик по «×» на бейдже.
  2. Бейдж пропадает (либо превращается в «Отменено»).
  3. В БД: `status='cancelled'`, `finished_at` заполнен.
  4. Можно снова «Отдать агенту» — создаётся новая job.

- [ ] **Step 3: Сценарий 3 — permission errors**

  1. Залогинься как viewer проекта.
  2. На TODO-карточке открой меню. Пункт «Отдать агенту» должен быть **отсутствовать** (если ты передал role через props), либо **возвращать 403** при клике с тостом ошибки.

- [ ] **Step 4: Сценарий 4 — task без описания**

  1. На пустой TODO-задаче меню → пункт disabled, серая подпись «нет описания».

- [ ] **Step 5: Сценарий 5 — duplicate**

  1. После enqueue на task с активной job — пункт «Отдать агенту» не показывается (см. условие `task.agentJob && status active`).

- [ ] **Step 6: Сценарий 6 — typecheck/lint clean**

  ```
  npm run typecheck
  npm run lint
  npm run build
  ```

  Все три зелёные.

### Task 5.2: MCP sync (если ProjectsFlow MCP подключён)

См. CLAUDE.md → «Ритуал коммита». Если в проекте есть kanban-задача под эту работу:

- [ ] `pf_list_tasks` для своего ProjectsFlow-проекта (cached project id из предыдущей сессии).
- [ ] Найди задачу про «Plan A: agent runner backend» / «agent_jobs schema» / similar.
- [ ] Если такая есть — AskUserQuestion: «Закрываем задачу X на Plan A: перенести в `На подтверждении`?». Если нет — просто продолжай.
- [ ] После `git push` — `pf_link_commit_to_task` для каждого из 4 коммитов фазы.

### Task 5.3: Push

- [ ] **Step 1:**

```
git push origin <branch>
```

(или прямо в `main` если делаешь в нём — спрашивай юзера)

---

## Что дальше — Plan B

После того как Plan A смерджен и работает:

- **Plan B** (отдельный документ) — runner-процесс: structure `server/src/runner/`, claim loop с `SELECT FOR UPDATE SKIP LOCKED`, wake-signal HTTP listener, `git worktree` управление, `claude -p` spawn с timeout, `gh pr create --draft`, cancellation registry с SIGTERM. PM2-конфиг обновляется на 2 процесса. После Plan B — job'ы реально начинают исполняться.

- **Не забыть для Plan B:** установить Claude CLI на сервере отдельной командой (см. spec секция 9), создать `GH_TOKEN`, добавить env-vars (`ANTHROPIC_API_KEY`, `GH_TOKEN`, `RUNNER_GLOBAL_CAP`, `RUNNER_JOB_TIMEOUT_MS`, и т.д.).

- **Out-of-scope обоих планов:** auto-merge PR, multi-step задачи, streaming Claude-вывода в UI, cost-tracking, scheduled-агенты — отдельные спеки.
