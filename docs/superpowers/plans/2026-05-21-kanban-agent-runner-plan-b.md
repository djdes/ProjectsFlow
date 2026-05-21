# Kanban Agent Runner — Plan B v2 (/loop architecture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать локальной Claude Code сессии возможность работать как agent runner через `/loop` — добавить 3 MCP-tool'а (`pf_list_pending_agent_jobs`, `pf_claim_agent_job`, `pf_complete_agent_job`), 3 server endpoint'а под `requireAgentToken`, slash-command `~/.claude/commands/check-agent-queue.md`. Сервер ничего не запускает — вся execution на машине юзера, через подписку Claude Pro/Max.

**Architecture:** Clean Architecture на сервере (новые use-cases `ListPendingAgentJobs`/`ClaimAgentJob`/`CompleteAgentJob`, расширение `AgentJobRepository` port'а). MCP-server (`@projectsflow/mcp-server`) bump до 0.7.0 с тремя новыми tool'ами. Slash-command — markdown-файл с детальным промптом для каждого /loop-тика. Никакого PM2-daemon'а, никакого `claude -p` на сервере.

**Tech Stack:** Node.js 22 · Express 4 · Drizzle ORM · MariaDB 10.11 · MCP SDK 1.0.4 · zod.

**Spec:** [2026-05-21-kanban-agent-runner-design.md](../specs/2026-05-21-kanban-agent-runner-design.md)

**Зависит от:** Plan A backend смерджен в main и задеплоен на прод. Таблица `agent_jobs` + UI кнопка существуют.

**Замечания по среде исполнения:**
- Корневая директория — `c:\www\ProjectsFlow`. Все пути в плане — относительно неё.
- Платформа — Windows + PowerShell. npm-скрипты работают cross-platform.
- Кириллица: UI/доки на русском, код на английском.
- Тестов нет в проекте (по той же конвенции что в Plan A) — каждая задача завершается typecheck/lint/build + ручной smoke.

---

## File Structure

### Server (new files)

```
server/src/application/agent/
  ListPendingAgentJobs.ts       — use-case
  ClaimAgentJob.ts              — use-case
  CompleteAgentJob.ts           — use-case
```

### Server (modified)

```
server/src/
├── application/agent/AgentJobRepository.ts          (add listPendingForUser, claimById; remove claimNext)
├── infrastructure/repositories/DrizzleAgentJobRepository.ts (implement new methods, remove claimNext stub)
├── domain/agent/errors.ts                           (add AgentJobAlreadyClaimedError, AgentJobNotInRunningStateError)
├── presentation/agent/apiRoutes.ts                  (add 3 new endpoints)
├── presentation/middleware/errorHandler.ts          (map 2 new errors → HTTP statuses)
├── presentation/config.ts                           (remove runnerEnabled, runnerSignalUrl — dead from Plan A)
├── presentation/http.ts                             (remove Plan-A daemon-signal wiring if any)
├── index.ts                                         (wire new use-cases; remove HttpAgentRunnerSignal / NoopAgentRunnerSignal)
└── .env.example                                     (remove RUNNER_ENABLED, RUNNER_SIGNAL_URL)
```

### Server (deleted)

```
server/src/
├── application/agent/AgentRunnerSignal.ts           (port — больше не нужен)
├── infrastructure/agent/HttpAgentRunnerSignal.ts    (impl)
└── infrastructure/agent/NoopAgentRunnerSignal.ts    (impl)
```

В `EnqueueAgentJob.execute` тоже убирается `void this.deps.signal.notifyJobEnqueued()` — больше некого будить.

### MCP server (modified)

```
mcp-server/
├── src/api.ts                          (add 3 methods + 1 type for pending job)
├── src/index.ts                        (add 3 tools to TOOLS array + handlers; bump version string)
├── package.json                        (version 0.6.0 → 0.7.0)
└── README.md                           (document 3 new tools)
```

### Slash-command (new file, локально у юзера)

```
~/.claude/commands/check-agent-queue.md     (полный текст из spec §9.3)
```

(Этот файл **не** в репо — он на машине юзера. План документирует что туда положить.)

### Docs (modified)

```
docs/ONBOARDING.md                      (новая секция «Настройка agent runner локально»)
CLAUDE.md                               (обновить раздел про MCP-tool'ы — добавить новые)
```

---

## Phase 1: Server — Domain + Application

Foundation: новые errors, расширение port'а, 3 use-case'а. Никакой инфраструктуры, никакого HTTP.

### Task 1.1: Добавить domain errors

**Files:**
- Modify: `server/src/domain/agent/errors.ts`

- [ ] **Step 1:** Открыть `errors.ts`, найти существующие классы `AgentJobNotFoundError` и `AgentJobNotCancellableError`. Добавить **в конец файла**:

```ts
export class AgentJobAlreadyClaimedError extends Error {
  constructor(jobId: string) {
    super(`Agent job ${jobId} is already claimed by another session`);
    this.name = 'AgentJobAlreadyClaimedError';
  }
}

export class AgentJobNotInRunningStateError extends Error {
  constructor(jobId: string, currentStatus: string) {
    super(`Agent job ${jobId} cannot be completed - current status: ${currentStatus}`);
    this.name = 'AgentJobNotInRunningStateError';
  }
}
```

(ASCII дефис в сообщениях, не em-dash — для consistency с правкой Phase 1 из Plan A.)

- [ ] **Step 2:** `cd server && npx tsc -p tsconfig.json --noEmit` — clean.

### Task 1.2: Расширить `AgentJobRepository` port

**Files:**
- Modify: `server/src/application/agent/AgentJobRepository.ts`

- [ ] **Step 1:** Открыть port-файл. **Удалить** метод:

```ts
claimNext(globalCap: number, runnerPid: number): Promise<AgentJob | null>;
```

**Добавить два новых метода** в тот же type:

```ts
/**
 * Все queued job'ы по проектам, где `userId` — member. Сортировка по createdAt asc.
 * Limit — для UI/MCP (≈10-50). Возвращает обогащённые pending-DTO'шки с inline
 * project name + git URL + task description, чтобы избежать N+1 запросов.
 */
listPendingForUser(userId: string, limit: number): Promise<PendingAgentJob[]>;

/**
 * Атомарный claim — UPDATE WHERE id=? AND status='queued' SET status='running',
 * claimed_at=NOW(), started_at=NOW(). Возвращает обновлённую job если apply удался,
 * либо null (уже claim'нута / отменена / не существует).
 */
claimById(jobId: string): Promise<AgentJob | null>;
```

Добавить тип `PendingAgentJob` (обогащённая DTO) в **том же файле**:

```ts
export type PendingAgentJob = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly gitRepoUrl: string | null;
  readonly taskId: string;
  readonly taskDescription: string | null;
  readonly createdAt: Date;
};
```

- [ ] **Step 2:** Typecheck упадёт на `DrizzleAgentJobRepository` (он implements port, теперь не покрывает методы). Это OK — следующий task починит.

### Task 1.3: Реализация в `DrizzleAgentJobRepository`

**Files:**
- Modify: `server/src/infrastructure/repositories/DrizzleAgentJobRepository.ts`

- [ ] **Step 1:** Удалить метод `claimNext(...)` целиком (stub из Plan A).

- [ ] **Step 2:** Добавить `listPendingForUser`:

```ts
async listPendingForUser(userId: string, limit: number): Promise<PendingAgentJob[]> {
  // JOIN: agent_jobs → projects → project_members WHERE pm.user_id=? AND aj.status='queued'
  // SELECT project.name, project.gitRepoUrl, task.description inline.
  const rows = await this.db
    .select({
      jobId: agentJobs.id,
      projectId: agentJobs.projectId,
      taskId: agentJobs.taskId,
      createdAt: agentJobs.createdAt,
      projectName: projects.name,
      gitRepoUrl: projects.gitRepoUrl,
      taskDescription: tasks.description,
    })
    .from(agentJobs)
    .innerJoin(projects, eq(agentJobs.projectId, projects.id))
    .innerJoin(tasks, eq(agentJobs.taskId, tasks.id))
    .innerJoin(projectMembers, eq(projectMembers.projectId, agentJobs.projectId))
    .where(and(
      eq(agentJobs.status, 'queued'),
      eq(projectMembers.userId, userId),
    ))
    .orderBy(asc(agentJobs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.jobId,
    projectId: r.projectId,
    projectName: r.projectName,
    gitRepoUrl: r.gitRepoUrl,
    taskId: r.taskId,
    taskDescription: r.taskDescription,
    createdAt: r.createdAt,
  }));
}
```

Импорты: `projects`, `projectMembers`, `tasks` из `../db/schema.js`. `asc` из `drizzle-orm`.

- [ ] **Step 3:** Добавить `claimById`:

```ts
async claimById(jobId: string): Promise<AgentJob | null> {
  const result = await this.db
    .update(agentJobs)
    .set({
      status: 'running',
      claimedAt: sql`CURRENT_TIMESTAMP`,
      startedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(agentJobs.id, jobId), eq(agentJobs.status, 'queued')));
  // Drizzle/mysql2 возвращает [ResultSetHeader, undefined] для UPDATE.
  // affectedRows проверка — посмотри как сделано в других репо в проекте:
  // если у DrizzleTaskCommentRepository.delete есть похожий паттерн — использовать его.
  const affected = (result as unknown as { rowsAffected?: number; affectedRows?: number })
    .rowsAffected ?? (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
  if (affected === 0) return null;
  return this.findById(jobId);
}
```

**Note:** Если в проекте уже есть utility-функция `getAffectedRows(result)` — использовать её. Иначе оставить inline.

- [ ] **Step 4:** Typecheck `cd server && npx tsc -p tsconfig.json --noEmit` — clean.

### Task 1.4: Use-case `ListPendingAgentJobs`

**Files:**
- Create: `server/src/application/agent/ListPendingAgentJobs.ts`

- [ ] **Step 1:** Создать файл:

```ts
import type {
  AgentJobRepository,
  PendingAgentJob,
} from './AgentJobRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type Deps = {
  readonly agentJobs: AgentJobRepository;
};

export class ListPendingAgentJobs {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; limit?: number }): Promise<PendingAgentJob[]> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return this.deps.agentJobs.listPendingForUser(input.userId, limit);
  }
}
```

Permissions: репозиторий уже фильтрует по `projectMembers` JOIN'ом. Use-case не делает дополнительных проверок.

- [ ] **Step 2:** Typecheck clean.

### Task 1.5: Use-case `ClaimAgentJob`

**Files:**
- Create: `server/src/application/agent/ClaimAgentJob.ts`

- [ ] **Step 1:** Создать файл:

```ts
import type { AgentJob } from '../../domain/agent/AgentJob.js';
import {
  AgentJobAlreadyClaimedError,
  AgentJobNotFoundError,
} from '../../domain/agent/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly agentJobs: AgentJobRepository;
};

export class ClaimAgentJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; jobId: string }): Promise<AgentJob> {
    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job) throw new AgentJobNotFoundError(input.jobId);

    // Permissions: на момент claim'а (не enqueue'а — роли могли быть отозваны).
    const membership = await this.deps.members.findForProject(job.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError();
    if (!can(membership.role, 'delegate_task_to_agent')) {
      throw new InsufficientProjectRoleError(membership.role, 'delegate_task_to_agent');
    }

    const claimed = await this.deps.agentJobs.claimById(input.jobId);
    if (!claimed) throw new AgentJobAlreadyClaimedError(input.jobId);
    return claimed;
  }
}
```

- [ ] **Step 2:** Typecheck clean.

### Task 1.6: Use-case `CompleteAgentJob`

**Files:**
- Create: `server/src/application/agent/CompleteAgentJob.ts`

- [ ] **Step 1:** Создать файл:

```ts
import {
  AgentJobNotFoundError,
  AgentJobNotInRunningStateError,
} from '../../domain/agent/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly agentJobs: AgentJobRepository;
};

export type CompleteAgentJobInput = {
  readonly userId: string;
  readonly jobId: string;
  readonly ok: boolean;
  readonly prUrl: string | null;
  readonly error: string | null;
  readonly branchName: string | null;
};

export class CompleteAgentJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: CompleteAgentJobInput): Promise<void> {
    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job) throw new AgentJobNotFoundError(input.jobId);

    const membership = await this.deps.members.findForProject(job.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError();
    if (!can(membership.role, 'delegate_task_to_agent')) {
      throw new InsufficientProjectRoleError(membership.role, 'delegate_task_to_agent');
    }

    if (job.status !== 'running') {
      throw new AgentJobNotInRunningStateError(input.jobId, job.status);
    }

    await this.deps.agentJobs.complete(input.jobId, {
      status: input.ok ? 'succeeded' : 'failed',
      error: input.error,
      prUrl: input.prUrl,
      branchName: input.branchName,
    });
  }
}
```

- [ ] **Step 2:** Typecheck clean.

### ⛳ Phase 1 checkpoint

- [ ] Commit:
  ```
  git add server/src/domain/agent/errors.ts server/src/application/agent/AgentJobRepository.ts server/src/infrastructure/repositories/DrizzleAgentJobRepository.ts server/src/application/agent/ListPendingAgentJobs.ts server/src/application/agent/ClaimAgentJob.ts server/src/application/agent/CompleteAgentJob.ts
  git commit -m "$(cat <<'EOF'
  feat(agent): use-cases для /loop-based runner (Plan B v2 Phase 1)

  - Новые domain-errors: AgentJobAlreadyClaimedError, AgentJobNotInRunningStateError
  - Port AgentJobRepository: добавлены listPendingForUser + claimById, удалён dead claimNext stub
  - DrizzleAgentJobRepository: реализация через JOIN с project_members для security-фильтра + атомарный UPDATE для claim
  - Use-cases: ListPendingAgentJobs, ClaimAgentJob, CompleteAgentJob

  Refs: docs/superpowers/specs/2026-05-21-kanban-agent-runner-design.md

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 2: Server — HTTP endpoints + cleanup dead daemon code

### Task 2.1: HTTP endpoints в agent/apiRoutes.ts

**Files:**
- Modify: `server/src/presentation/agent/apiRoutes.ts`

- [ ] **Step 1:** Добавить импорты:

```ts
import type { ListPendingAgentJobs } from '../../application/agent/ListPendingAgentJobs.js';
import type { ClaimAgentJob } from '../../application/agent/ClaimAgentJob.js';
import type { CompleteAgentJob } from '../../application/agent/CompleteAgentJob.js';
import type { PendingAgentJob } from '../../application/agent/AgentJobRepository.js';
```

- [ ] **Step 2:** Расширить `Deps` type:

```ts
readonly listPendingAgentJobs: ListPendingAgentJobs;
readonly claimAgentJob: ClaimAgentJob;
readonly completeAgentJob: CompleteAgentJob;
```

- [ ] **Step 3:** Добавить DTO-функцию для PendingAgentJob (рядом с `taskToDto` и т.д.):

```ts
type PendingAgentJobDto = Omit<PendingAgentJob, 'createdAt'> & { createdAt: string };

function pendingAgentJobToDto(p: PendingAgentJob): PendingAgentJobDto {
  return { ...p, createdAt: p.createdAt.toISOString() };
}
```

Также убедись что `agentJobToDto` уже импортирован (он должен быть в этом же router'е либо в `agent-jobs/dto.ts` — посмотри что используется).

- [ ] **Step 4:** Добавить zod-схему для complete body:

```ts
const completeAgentJobBodySchema = z.object({
  ok: z.boolean(),
  prUrl: z.string().url().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  branchName: z.string().max(200).nullable().optional(),
});
```

- [ ] **Step 5:** Добавить 3 endpoint'а (после существующих, перед `return router;`):

```ts
// GET /api/agent/pending-agent-jobs?limit=10
// Pending agent-job'ы по всем проектам, где юзер — member. Для /loop-промпта.
router.get('/pending-agent-jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limitParam = req.query['limit'];
    const limit = limitParam ? parseInt(String(limitParam), 10) : undefined;
    const jobs = await deps.listPendingAgentJobs.execute({
      userId: req.user!.id,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ jobs: jobs.map(pendingAgentJobToDto) });
  } catch (e) {
    next(e);
  }
});

// POST /api/agent/agent-jobs/:jobId/claim
// Атомарный pickup. 409 если другая сессия успела первой.
router.post('/agent-jobs/:jobId/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params['jobId'] as string;
    const job = await deps.claimAgentJob.execute({ userId: req.user!.id, jobId });
    res.json({ job: agentJobToDto(job) });
  } catch (e) {
    next(e);
  }
});

// POST /api/agent/agent-jobs/:jobId/complete
// Финализация. Body: {ok, prUrl?, error?, branchName?}
router.post('/agent-jobs/:jobId/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params['jobId'] as string;
    const body = completeAgentJobBodySchema.parse(req.body);
    await deps.completeAgentJob.execute({
      userId: req.user!.id,
      jobId,
      ok: body.ok,
      prUrl: body.prUrl ?? null,
      error: body.error ?? null,
      branchName: body.branchName ?? null,
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
```

`agentJobToDto` — функция уже существует в репо (была добавлена в Plan A Phase 3 → выделена в `presentation/agent-jobs/dto.ts` в Phase 3 fix). Проверь актуальный импорт-путь.

### Task 2.2: ErrorHandler ↔ HTTP statuses

**Files:**
- Modify: `server/src/presentation/middleware/errorHandler.ts`

- [ ] **Step 1:** Импортировать новые errors:

```ts
import {
  AgentJobAlreadyClaimedError,
  AgentJobNotInRunningStateError,
} from '../../domain/agent/errors.js';
```

- [ ] **Step 2:** Добавить branches:

```ts
if (err instanceof AgentJobAlreadyClaimedError) {
  return res.status(409).json({ error: 'agent_job_already_claimed', message: err.message });
}
if (err instanceof AgentJobNotInRunningStateError) {
  return res.status(409).json({ error: 'agent_job_not_in_running_state', message: err.message });
}
```

### Task 2.3: Wire новые use-cases в `index.ts`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1:** Импорты:

```ts
import { ListPendingAgentJobs } from './application/agent/ListPendingAgentJobs.js';
import { ClaimAgentJob } from './application/agent/ClaimAgentJob.js';
import { CompleteAgentJob } from './application/agent/CompleteAgentJob.js';
```

- [ ] **Step 2:** В секции `agent: { ... }` добавить:

```ts
listPendingAgentJobs: new ListPendingAgentJobs({ agentJobs: agentJobRepository }),
claimAgentJob: new ClaimAgentJob({ members: projectMemberRepo, agentJobs: agentJobRepository }),
completeAgentJob: new CompleteAgentJob({ members: projectMemberRepo, agentJobs: agentJobRepository }),
```

(`agentJobRepository` и `projectMemberRepo` — имена переменных подгони под реальные в файле.)

- [ ] **Step 3:** Передать в `http.ts` builder:

В `http.ts` (в части где собирается `agentApiRouter`):

```ts
listPendingAgentJobs: deps.agent.listPendingAgentJobs,
claimAgentJob: deps.agent.claimAgentJob,
completeAgentJob: deps.agent.completeAgentJob,
```

И в `AppDeps.agent` type добавить эти три поля.

### Task 2.4: Cleanup dead daemon code

**Files:**
- Delete: `server/src/application/agent/AgentRunnerSignal.ts`
- Delete: `server/src/infrastructure/agent/HttpAgentRunnerSignal.ts`
- Delete: `server/src/infrastructure/agent/NoopAgentRunnerSignal.ts`
- Modify: `server/src/application/agent/EnqueueAgentJob.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/presentation/config.ts`
- Modify: `.env.example`

- [ ] **Step 1:** Удалить файлы:

```
rm server/src/application/agent/AgentRunnerSignal.ts
rm server/src/infrastructure/agent/HttpAgentRunnerSignal.ts
rm server/src/infrastructure/agent/NoopAgentRunnerSignal.ts
```

(или эквивалент в PowerShell)

- [ ] **Step 2:** Из `EnqueueAgentJob.ts` удалить:
  - Импорт `AgentRunnerSignal`
  - Поле `signal` из `Deps` type
  - Вызов `void this.deps.signal.notifyJobEnqueued().catch(...)` в конце `execute`

- [ ] **Step 3:** Из `index.ts` удалить:
  - Импорты `HttpAgentRunnerSignal`, `NoopAgentRunnerSignal`
  - Создание `agentRunnerSignal` (conditional между Http/Noop)
  - Поле `signal: agentRunnerSignal` из `EnqueueAgentJob` deps

- [ ] **Step 4:** Из `config.ts` удалить:
  - Поля `runnerEnabled` и `runnerSignalUrl` из `Config` type
  - Чтение env-vars `RUNNER_ENABLED` и `RUNNER_SIGNAL_URL` в `loadConfig()`
  - Если они под объектом `runner.*` — удалить весь объект `runner`

- [ ] **Step 5:** Из `.env.example` удалить блок:

```
# === Kanban Agent Runner (Plan B activates this) ===
RUNNER_ENABLED=false
RUNNER_SIGNAL_URL=http://127.0.0.1:4318
```

- [ ] **Step 6:** `cd server && npx tsc -p tsconfig.json --noEmit` + `npm run lint` — green.

### Task 2.5: Smoke test (curl)

- [ ] **Step 1:** `npm run dev:server` в одном терминале.

- [ ] **Step 2:** Получить agent-token (из `~/.config/projectsflow/agent.json` либо создать новый через UI).

- [ ] **Step 3:** GET pending:

```bash
curl -s -H "Authorization: Bearer pfat_..." http://localhost:4317/api/agent/pending-agent-jobs | jq
# Expected: {"jobs":[]} если нет queued
```

- [ ] **Step 4:** Создать одну job через существующий enqueue endpoint (UI или curl POST на сессии).

- [ ] **Step 5:** GET pending снова — должен вернуть 1 job с projectName/gitRepoUrl/taskDescription.

- [ ] **Step 6:** Claim:

```bash
curl -s -X POST -H "Authorization: Bearer pfat_..." \
  http://localhost:4317/api/agent/agent-jobs/<jobId>/claim | jq
# Expected: {"job": {..., "status": "running"}}
```

- [ ] **Step 7:** Повторный claim:

```bash
curl -s -X POST -H "Authorization: Bearer pfat_..." \
  http://localhost:4317/api/agent/agent-jobs/<jobId>/claim
# Expected: 409 {"error": "agent_job_already_claimed", ...}
```

- [ ] **Step 8:** Complete:

```bash
curl -s -X POST -H "Authorization: Bearer pfat_..." \
  -H "Content-Type: application/json" \
  -d '{"ok":true,"prUrl":"https://github.com/djdes/X/pull/1","branchName":"agent/test"}' \
  http://localhost:4317/api/agent/agent-jobs/<jobId>/complete -i
# Expected: HTTP/1.1 204 No Content
```

- [ ] **Step 9:** В UI: бейдж на карточке должен показать «PR #...» зелёным.

### ⛳ Phase 2 checkpoint

- [ ] Commit:
  ```
  git add server/src/presentation/agent/apiRoutes.ts server/src/presentation/middleware/errorHandler.ts server/src/index.ts server/src/presentation/http.ts server/src/application/agent/EnqueueAgentJob.ts server/src/presentation/config.ts .env.example
  git rm server/src/application/agent/AgentRunnerSignal.ts server/src/infrastructure/agent/HttpAgentRunnerSignal.ts server/src/infrastructure/agent/NoopAgentRunnerSignal.ts
  git commit -m "$(cat <<'EOF'
  feat(agent): HTTP endpoints для /loop + cleanup dead daemon code

  Plan B v2 Phase 2:
  - 3 новых endpoint'а под requireAgentToken:
    GET /api/agent/pending-agent-jobs?limit
    POST /api/agent/agent-jobs/:id/claim
    POST /api/agent/agent-jobs/:id/complete
  - errorHandler: 2 новых ветки (409 already_claimed, 409 not_in_running_state)
  - Удалён dead daemon-код: AgentRunnerSignal port + HttpAgentRunnerSignal +
    NoopAgentRunnerSignal + RUNNER_ENABLED/RUNNER_SIGNAL_URL env-vars
  - EnqueueAgentJob больше не зовёт signal.notifyJobEnqueued (некого будить)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 3: MCP server — 3 new tools

### Task 3.1: api.ts — методы и типы

**Files:**
- Modify: `mcp-server/src/api.ts`

- [ ] **Step 1:** Добавить тип:

```ts
export type PendingAgentJob = {
  id: string;
  projectId: string;
  projectName: string;
  gitRepoUrl: string | null;
  taskId: string;
  taskDescription: string | null;
  createdAt: string;
};

export type AgentJobDto = {
  id: string;
  projectId: string;
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempt: number;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  prUrl: string | null;
  branchName: string | null;
  runnerPid: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CompleteAgentJobInput = {
  ok: boolean;
  prUrl?: string | null;
  error?: string | null;
  branchName?: string | null;
};
```

- [ ] **Step 2:** Добавить методы в `ApiClient`:

```ts
async listPendingAgentJobs(limit: number): Promise<PendingAgentJob[]> {
  const { jobs } = await this.request<{ jobs: PendingAgentJob[] }>(
    `/agent/pending-agent-jobs?limit=${limit}`,
  );
  return jobs;
}

async claimAgentJob(jobId: string): Promise<AgentJobDto> {
  const { job } = await this.request<{ job: AgentJobDto }>(
    `/agent/agent-jobs/${encodeURIComponent(jobId)}/claim`,
    { method: 'POST', body: {} },
  );
  return job;
}

async completeAgentJob(jobId: string, input: CompleteAgentJobInput): Promise<void> {
  await this.request<void>(
    `/agent/agent-jobs/${encodeURIComponent(jobId)}/complete`,
    { method: 'POST', body: input },
  );
}
```

### Task 3.2: index.ts — tools + handlers

**Files:**
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1:** Добавить 3 tool definitions в массив `TOOLS` (после существующих):

```ts
{
  name: 'pf_list_pending_agent_jobs',
  description:
    'List queued agent-jobs across ALL projects the current user is a member of, oldest first. ' +
    'Each item includes project name, git repo URL, task description, and createdAt. Use this ' +
    'at the start of every /check-agent-queue tick: if the array is empty, exit immediately ' +
    "with a short message (don't burn message budget on empty ticks). If non-empty, pick the " +
    'FIRST item and proceed to pf_claim_agent_job.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description: 'Max jobs to return (default 10, max 50)',
      },
    },
    additionalProperties: false,
  },
},
{
  name: 'pf_claim_agent_job',
  description:
    'Atomically claim a queued agent-job — moves status from queued to running. Returns the ' +
    "updated job. If another /loop session already claimed it (status≠queued), returns 409 " +
    '"agent_job_already_claimed" — skip the job and try the next one (or exit if list ' +
    'returned only one). Always call this immediately after pf_list_pending_agent_jobs picks ' +
    'a candidate, before doing any work.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'Agent job id (from pf_list_pending_agent_jobs)' },
    },
    required: ['jobId'],
    additionalProperties: false,
  },
},
{
  name: 'pf_complete_agent_job',
  description:
    'Finalize an agent-job. Call this ONCE at the end of work — either after successful PR ' +
    "creation (ok=true, prUrl=<url>, branchName=<branch>), or after failure (ok=false, " +
    'error=<short reason>). Sets status to succeeded or failed, fills finished_at. If the ' +
    'job was cancelled by the user during your work, this call returns 409 ' +
    '"agent_job_not_in_running_state" — handle by cleaning up the local branch/worktree and ' +
    'NOT pushing the PR.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'Agent job id' },
      ok: { type: 'boolean', description: 'true on success, false on failure' },
      prUrl: { type: ['string', 'null'], description: 'PR URL if PR was created' },
      error: { type: ['string', 'null'], description: 'Short failure reason' },
      branchName: { type: ['string', 'null'], description: 'Branch name that agent worked on' },
    },
    required: ['jobId', 'ok'],
    additionalProperties: false,
  },
},
```

- [ ] **Step 2:** Добавить zod-схемы:

```ts
const ListPendingAgentJobsInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

const ClaimAgentJobInput = z.object({
  jobId: z.string().min(1),
});

const CompleteAgentJobInput = z.object({
  jobId: z.string().min(1),
  ok: z.boolean(),
  prUrl: z.string().url().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  branchName: z.string().max(200).nullable().optional(),
});
```

- [ ] **Step 3:** Handler-cases в switch'е (после существующих):

```ts
case 'pf_list_pending_agent_jobs': {
  const input = ListPendingAgentJobsInput.parse(req.params.arguments ?? {});
  const jobs = await api.listPendingAgentJobs(input.limit ?? 10);
  return jsonResult(jobs);
}
case 'pf_claim_agent_job': {
  const input = ClaimAgentJobInput.parse(req.params.arguments ?? {});
  const job = await api.claimAgentJob(input.jobId);
  return jsonResult(job);
}
case 'pf_complete_agent_job': {
  const input = CompleteAgentJobInput.parse(req.params.arguments ?? {});
  await api.completeAgentJob(input.jobId, {
    ok: input.ok,
    prUrl: input.prUrl ?? null,
    error: input.error ?? null,
    branchName: input.branchName ?? null,
  });
  return jsonResult({ ok: true });
}
```

- [ ] **Step 4:** Bump server name version:

```ts
const server = new Server(
  { name: 'projectsflow', version: '0.7.0' },
  { capabilities: { tools: {} } },
);
```

### Task 3.3: package.json + README

**Files:**
- Modify: `mcp-server/package.json` — version `0.6.0` → `0.7.0`
- Modify: `mcp-server/README.md` — добавить новый раздел или дополнить existing раздел «Kanban / задачи» тремя новыми tool'ами:

```md
| `pf_list_pending_agent_jobs` | Top-N queued agent-job'ов по всем проектам юзера. Для /loop-полла. |
| `pf_claim_agent_job` | Атомарный pickup queued→running. 409 если race. |
| `pf_complete_agent_job` | Финализация job: ok=true с prUrl или ok=false с error. |
```

### Task 3.4: Build + verify

- [ ] **Step 1:** `cd mcp-server && npm run build` — `dist/` собрался.

- [ ] **Step 2:** Локальный smoke: настроить временно `claude mcp add` указав на локальный dist (или `link`'нуть), вызвать в Claude Code тестовом сессии:
  - `pf_list_pending_agent_jobs(limit=5)` — должен вернуть массив (возможно пустой).
  - Если есть pending job — `pf_claim_agent_job(jobId)` → объект job.
  - Повторный `pf_claim_agent_job(тот же jobId)` → ошибка `agent_job_already_claimed`.
  - `pf_complete_agent_job(jobId, ok=true, prUrl="...", branchName="...")` → `{ok: true}`.

### ⛳ Phase 3 checkpoint

- [ ] Commit:
  ```
  git add mcp-server/src/api.ts mcp-server/src/index.ts mcp-server/package.json mcp-server/README.md
  git commit -m "$(cat <<'EOF'
  feat(mcp): pf_list_pending_agent_jobs + pf_claim + pf_complete (0.7.0)

  Plan B v2 Phase 3: три новых tool'а для /loop-based agent runner.
  - pf_list_pending_agent_jobs(limit?) — queued job'ы по всем доступным проектам
  - pf_claim_agent_job(jobId) — атомарный pickup, 409 при race
  - pf_complete_agent_job(jobId, ok, prUrl?, error?, branchName?) — финализация
  README обновлён.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 4: Slash-command + docs

### Task 4.1: Slash-command markdown

**Files:**
- Create (на машине юзера): `~/.claude/commands/check-agent-queue.md`

- [ ] **Step 1:** Скопировать полный текст из spec §9.3 в файл.

(Этот файл **не коммитится в репо** — он на машине юзера. План документирует это.)

- [ ] **Step 2:** Сделать минимальный test:

```
cd ~/agent-workspace
claude
> /check-agent-queue
```

Должен либо «Нет pending agent-job'ов» либо начать обрабатывать первую.

### Task 4.2: ONBOARDING.md — секция «Настройка agent runner локально»

**Files:**
- Modify: `docs/ONBOARDING.md`

- [ ] **Step 1:** Добавить секцию (например после § 4 «Деплой» — § 4.5 или новый § 5):

```md
## Настройка agent runner локально

ProjectsFlow умеет автоматически выполнять задачи через локальную Claude Code сессию
(см. `docs/superpowers/specs/2026-05-21-kanban-agent-runner-design.md`).

### Pre-requisites

- Claude Code, залогинен (Pro/Max подписка через `claude login`).
- `gh` CLI: `gh auth login`.
- Git + SSH key в GitHub.
- MCP-token: `npx -y @projectsflow/mcp-server@latest setup` — один раз создаст
  `~/.config/projectsflow/agent.json`.

### Workspace

Создай директорию-агрегатор:

```bash
mkdir -p ~/agent-workspace && cd ~/agent-workspace
gh repo clone djdes/ProjectsFlow
gh repo clone djdes/OrdersFlow
# ... все репо к которым может прикасаться агент
```

### Slash-command

В `~/.claude/commands/check-agent-queue.md` положи markdown с инструкциями
(полный текст в spec §9.3). Это глобальная Claude Code команда — будет доступна
во всех твоих сессиях.

### Запуск

```bash
cd ~/agent-workspace
claude
> /loop 10m /check-agent-queue
```

`10m` — интервал поллинга. Хватает на разумную реакцию без сжигания rate-limit'а
подписки. Закрыл терминал → /loop остановился. Открыл — запустил снова.
```

### Task 4.3: CLAUDE.md — упомянуть новые tool'ы

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** В секции «Ритуал коммита: sync с kanban-задачами через MCP» (или новой подсекции) — добавить упоминание `pf_list_pending_agent_jobs`/`pf_claim_agent_job`/`pf_complete_agent_job` с короткой ссылкой на `docs/ONBOARDING.md` для setup'а.

Пример формулировки (вставить после существующего описания tools):

```md
**Agent-runner tools (используются /check-agent-queue slash-command'ом, не CLAUDE.md ритуалом):**

- `pf_list_pending_agent_jobs` / `pf_claim_agent_job` / `pf_complete_agent_job` — для запуска
  локальной /loop-сессии, см. `docs/ONBOARDING.md` → «Настройка agent runner локально».
  Если ты в обычной сессии и не запускаешь /loop — не трогай эти tool'ы.
```

### ⛳ Phase 4 checkpoint

- [ ] Commit:
  ```
  git add docs/ONBOARDING.md CLAUDE.md
  git commit -m "$(cat <<'EOF'
  docs(agent): инструкция по настройке /loop-based runner локально

  - ONBOARDING.md: новая секция с pre-requisites, workspace setup, slash-command,
    запуск /loop 10m /check-agent-queue.
  - CLAUDE.md: упоминание новых agent-runner tool'ов с reference на ONBOARDING.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase 5: E2E + publish + deploy

### Task 5.1: Full e2e walkthrough

- [ ] **Step 1:** В UI: создай задачу с осмысленным описанием (например, «добавь строку в README с текущей датой»). Жми «Отдать агенту».

- [ ] **Step 2:** В terminal'е: открой Claude Code в `~/agent-workspace/`, запусти `/loop 10m /check-agent-queue`.

- [ ] **Step 3:** Жди до 10 минут (или вызови `/check-agent-queue` руками ещё раз чтобы ускорить):
  - Claude должен вызвать `pf_list_pending_agent_jobs` → получить твою задачу.
  - `pf_claim_agent_job` → захватить её, status='running'.
  - Бейдж в UI должен меняться на «🤖 Работает».
  - Claude должен оставить comment «Беру в работу» через `pf_create_task_comment`.
  - Claude должен сделать commit + push + `gh pr create --draft`.
  - `pf_complete_agent_job(ok=true, prUrl=...)`.
  - Бейдж в UI должен меняться на «🤖 PR #N» (зелёный).

- [ ] **Step 4:** Открой полученный PR на GitHub — он draft, содержит изменения README с датой.

- [ ] **Step 5:** Cancel-flow: создай ещё задачу, отдай агенту, отмени её через UI пока агент ещё не дошёл до неё (status='queued'). Бейдж → «Отменено». /loop не подхватит.

- [ ] **Step 6:** Race-flow (если есть две машины): на обеих запусти /loop, создай задачу. Один из двух экземпляров получит 409 на claim'е и аккуратно пропустит. Второй сделает работу.

### Task 5.2: Publish mcp-server 0.7.0

- [ ] **Step 1:** `cd mcp-server && npm publish`. Если 2FA — введи OTP.

- [ ] **Step 2:** Verify: `npm view @projectsflow/mcp-server@0.7.0 version` → `0.7.0`.

### Task 5.3: Deploy backend

- [ ] **Step 1:** Merge ветки в main:

```bash
git checkout main
git merge --ff-only feat/agent-runner-loop   # или какое имя ветки выбрал
git push github main
```

GH Actions auto-deploy сработает (как для Plan A).

- [ ] **Step 2:** Дождись зелёного workflow run на https://github.com/djdes/ProjectsFlow/actions

- [ ] **Step 3:** Smoke: `curl https://projectsflow.ru/api/health` → 200. `curl ... /api/agent/pending-agent-jobs` с прод-токеном → 200 + jobs.

### Task 5.4: Final cleanup

- [ ] **Step 1:** Удалить merged-ветку:

```bash
git branch -d feat/agent-runner-loop
git push github --delete feat/agent-runner-loop
```

- [ ] **Step 2:** Если Plan A была отдельной веткой и ещё не смерджена — теперь её надо мерджить тоже (или она была мерджена ранее — в этом случае nothing to do).

---

## Что дальше (out of scope этого плана)

- **UI nudge** «есть N pending agent-job'ов, запусти /loop». Можно добавить отдельной маленькой спекой.
- **Per-user agent identity** — отдельная спека, нужна для multi-developer use case.
- **Cost-tracking** — отдельная спека (потребует метрики из подписки).
- **Cron-scheduled agent jobs** — отдельная спека (server-side scheduler создаёт jobs автоматически).
- **Retry policy** для failed — отдельная спека (auto-retry с экспоненциальным backoff).
