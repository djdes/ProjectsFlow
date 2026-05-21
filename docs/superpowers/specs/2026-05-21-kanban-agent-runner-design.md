# Spec: Kanban Agent Runner — авто-выполнение TODO-задач через headless Claude

**Дата:** 2026-05-21
**Статус:** Утверждён (брейншторм), готов к плану реализации
**Зависит от:** Текущий MCP-сервер (`@projectsflow/mcp-server`), Spec #5 (Multi-tenant projects)
**Открывает дорогу для:** GitHub-PR-агенты на чужих репо, scheduled-агенты (cron-задачи), agent-marketplace

---

## 1. Контекст и scope

### Зачем сейчас

У нас уже есть MCP-сервер, который даёт Claude Code доступ к kanban-задачам через tool'ы `pf_list_tasks`/`pf_link_commit_to_task` и т.д. Но **триггер у этого flow всегда юзер** — он сидит в Claude Code, говорит «возьми задачу X», Claude её делает.

Хочется обратной стороны: юзер кладёт задачу в TODO, ставит флаг «отдать агенту», уходит пить кофе. На сервере крутится daemon, который:
1. Получает webhook о флаге.
2. Берёт задачу в работу (claim).
3. Запускает headless Claude (`claude -p`) в изолированном worktree.
4. Claude через MCP читает задачу, делает изменения, открывает PR.
5. Юзер видит PR в GitHub и результат на доске.

Это первый шаг к тому, что ProjectsFlow становится не только местом хранения задач, а оркестратором их выполнения. Сейчас делаем минимальную, безопасную версию — отдельный worker-процесс, PR-only, без auto-merge, с глобальным cap'ом по параллелизму.

### Что ВНУТРИ scope

**Модель задачи для агента:**
- Новое булево поле `tasks.delegated_to_agent` (default `false`). Поднимается через UI «Отдать агенту» в TODO-карточке.
- Флаг **не меняет** видимый статус задачи — она остаётся в TODO до того, как агент claim'ит её.
- При claim'е daemon переводит `todo → in_progress` через существующий use-case `MoveTask`.

**Новая таблица очереди:**
- `agent_jobs (id, project_id, task_id, status, attempt, claimed_at, started_at, finished_at, error, pr_url, runner_pid, created_at, updated_at)`.
- `status` enum: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
- Per-project mutex: SQL `WHERE project_id=? AND status='running'` при claim'е → если есть, ждём.
- Global cap: `WHERE status='running'` < N (config) перед claim'ом.

**Daemon (runner-процесс):**
- Отдельный PM2-процесс `projectsflow-runner` внутри того же `server/` workspace'а.
- Один и тот же бинарник может быть запущен как `node server/dist/index.js` (API) или `node server/dist/runner.js` (worker). Общий DI-контейнер, общая Drizzle-схема, общий `.env`.
- В цикле: poll БД на `queued`-job'ы (через LISTEN/NOTIFY нет — MariaDB не умеет; обычный SELECT раз в N секунд). Plus event-driven wakeup: webhook кладёт job в БД И посылает SIGUSR1 / HTTP-сигнал на runner-процесс для немедленного pickup'а. Бэкап через poll спасает если signal потерян.

**Webhook flow:**
- POST `/api/agent/jobs` (внутренний endpoint, требует session-cookie юзера + role `editor+` на проекте). Принимает `{projectId, taskId}`. Кладёт в `agent_jobs (status=queued)`, посылает сигнал runner'у.
- Backward-compat: HTTP внутри одного процесса. Никаких HMAC и cross-host webhook'ов в v1.
- Cancel: DELETE `/api/agent/jobs/:id`. Если `status=queued` → ставит `cancelled`. Если `status=running` → SIGTERM по `runner_pid`, ждёт graceful shutdown, ставит `cancelled`.

**Runner exec:**
- Для каждой job:
  1. `git worktree add /var/www/projectsflow/agent-workspaces/<job_id> <branch_name>` — изолированная копия репо.
  2. Branch name: `agent/<short_task_id>-<slugified-first-line-of-desc>`.
  3. `cd` в worktree, экспорт env: `PROJECTSFLOW_AGENT_TOKEN`, `ANTHROPIC_API_KEY`, `GH_TOKEN`.
  4. `claude -p "<system + task prompt>" --permission-mode acceptEdits --output-format stream-json` с timeout (config, default 30 мин).
  5. После выхода Claude: проверить `git status` — есть ли коммиты в branch?
     - Да → `git push origin <branch>`, `gh pr create --title "..." --body "..." --draft`, записать `pr_url` в job.
     - Нет → job → `failed` с причиной "no changes".
  6. `git worktree remove --force` (cleanup).
- Stdout/stderr Claude → файл `/var/log/projectsflow-runner/<job_id>.log`. Job в БД хранит только tail (последние 4KB) в поле `error` при `failed`.

**Permission policy:**
- Только `editor+` member проекта может отдать задачу агенту. Owner может ограничить ещё сильнее в настройках проекта позже (out of scope v1).
- Webhook endpoint требует session-cookie. Никаких agent-token'ов на этом маршруте — только люди.

**UI:**
- В KanbanCard для задач со `status='todo'`: dropdown-menu item «Отдать агенту» (иконка робота).
- При наличии активной job (`status` ∈ `queued`/`running`) на этой задаче: бейдж «🤖 в очереди» / «🤖 работает» вместо кнопки, плюс ссылка «Открыть лог» (если running) и «Отменить».
- При `succeeded`: бейдж «🤖 PR #N» — ссылка на pr_url. Бейдж висит на карточке до её перехода в `done`.
- Опрос статуса — простой polling раз в 5s через `GET /api/projects/:id/tasks` (расширяем endpoint, чтобы возвращал `agentJob` summary inline). React Query не используем (стек), пока через `useEffect + setInterval`.

### Что СНАРУЖИ scope (следующие спеки)

| Тема | Куда |
|---|---|
| Auto-merge PR на основе CI | Отдельная — нужна интеграция с GitHub Actions, политика approval |
| Multi-step задачи (план → подтверждение → exec) | Отдельная, в v1 агент идёт от описания до PR одним shot'ом |
| Stream Claude-вывод в UI в реальном времени | Отдельная — SSE-эндпоинт + парсинг stream-json |
| Запуск агента на чужом репо (не GitHub) | Отдельная — нужна абстракция над PR-провайдером (GitLab, Bitbucket) |
| Cost-tracking и budget-лимиты на проект | Отдельная — нужна биллинг-инфра |
| Retry политика для `failed` | Отдельная — в v1 только manual retry (юзер опять жмёт «Отдать агенту») |
| Scheduled-agents (cron) | Отдельная |
| Agent-marketplace, шаблоны промптов | Сильно позже |
| HMAC-webhook от внешних систем | Сильно позже — пока всё внутри одного процесса |

---

## 2. Изменения схемы БД

### 2.1 Миграция 014_agent_jobs.sql

```sql
-- Очередь и история задач для kanban-agent runner'а.

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

`branch_name` хранится отдельно — нужен для cancel-flow (надо удалить ветку при abort'е) и для UI.

`runner_pid` — для SIGTERM при cancel'е. NULL у `queued`-job'ов.

`created_by` — `users.id`, для аудита «кто отдал агенту».

### 2.2 Миграция 015_task_delegated_to_agent.sql

```sql
ALTER TABLE tasks
  ADD COLUMN delegated_to_agent BOOLEAN NOT NULL DEFAULT FALSE;
```

Поле sticky — не сбрасывается после завершения job'а. UI ориентируется на наличие активной job в `agent_jobs` (статус `queued`/`running`), а не на этот флаг. Зачем тогда поле? — для будущего: если захотим, чтобы «отданная агенту» задача re-queue'илась автоматически при отказе CI, мы будем смотреть на флаг.

В v1 можно его и не использовать, ставить только при создании job'а — но добавляем сразу, чтобы не было ещё одной миграции через неделю.

---

## 3. Application-слой

### 3.1 Domain

```
server/src/domain/agent/
  AgentJob.ts          — entity
  AgentJobStatus.ts    — type alias + AGENT_JOB_STATUSES const
  errors.ts            — AgentJobNotFoundError, ProjectMutexError, GlobalCapReachedError
```

```ts
// AgentJob.ts
export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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

### 3.2 Ports

```
server/src/application/agent/
  AgentJobRepository.ts        — port
  AgentRunnerSignal.ts         — port (wake-up runner process)
  EnqueueAgentJob.ts           — use-case (called by webhook)
  CancelAgentJob.ts            — use-case
  ClaimNextAgentJob.ts         — use-case (called by runner loop)
  MarkAgentJobStarted.ts       — use-case
  CompleteAgentJob.ts          — use-case (success or failure)
  ListAgentJobsForProject.ts   — use-case (for UI status polling)
```

**`AgentJobRepository` интерфейс:**
```ts
export type AgentJobRepository = {
  create(input: NewAgentJob): Promise<AgentJob>;
  findById(id: string): Promise<AgentJob | null>;
  findActiveByTaskId(taskId: string): Promise<AgentJob | null>; // queued | running
  listForProject(projectId: string, limit: number): Promise<AgentJob[]>;
  /**
   * Атомарный claim: ищет самую старую queued-job, для которой:
   *  - в её проекте нет job со status=running,
   *  - глобально количество running < globalCap,
   * переводит её в running, ставит claimed_at, runner_pid.
   * Возвращает job или null если нет кандидата.
   */
  claimNext(globalCap: number, runnerPid: number): Promise<AgentJob | null>;
  markStarted(id: string): Promise<void>;
  complete(id: string, result: AgentJobResult): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
};
```

Реализация `claimNext` через одну транзакцию + `SELECT ... FOR UPDATE SKIP LOCKED` (MariaDB 10.6+ умеет; у нас 10.11 — ок). Подзапросы внутри: считает running-job'ы глобально и для конкретного проекта.

**`AgentRunnerSignal` интерфейс:**
```ts
export type AgentRunnerSignal = {
  notifyJobEnqueued(): Promise<void>;
};
```

Реализаций две:
- `HttpAgentRunnerSignal` — POST на `http://127.0.0.1:<runner-port>/wake` (runner поднимает мини-HTTP).
- `NoopAgentRunnerSignal` — для случая «runner отключён» (env-var `RUNNER_ENABLED=false`).

Выбор в `infrastructure/di/container.ts` по env.

### 3.3 Permissions

Добавляем в `server/src/domain/project/permissions.ts`:

```ts
export type ProjectAction =
  | ...existing...
  | 'delegate_task_to_agent'
  | 'cancel_agent_job';

const REQUIRED_ROLE: Record<ProjectAction, ProjectRole> = {
  ...existing...,
  delegate_task_to_agent: 'editor',
  cancel_agent_job: 'editor',
};
```

---

## 4. Runner-процесс

### 4.1 Структура

```
server/src/runner/
  index.ts             — entry point (process.argv === 'runner')
  loop.ts              — main loop: claim → exec → complete
  exec.ts              — single-job executor (worktree + claude + push + PR)
  signalServer.ts      — мини HTTP listener на 127.0.0.1, /wake endpoint
  cancellation.ts      — registry inflight jobs → process refs (для SIGTERM)
  prompt.ts            — system-prompt builder (читает task + проект-контекст)
  logs.ts              — append-only лог-файлы в /var/log/projectsflow-runner/
```

Entry point — отдельный bin внутри `server/`:

```jsonc
// server/package.json
{
  "scripts": {
    "dev:server": "tsx watch src/index.ts",
    "dev:runner": "tsx watch src/runner/index.ts",
    ...
  },
  "bin": {
    "projectsflow-server": "dist/index.js",
    "projectsflow-runner": "dist/runner/index.js"
  }
}
```

В `ecosystem.config.cjs` — два процесса: `projectsflow-api` и `projectsflow-runner`. Оба читают тот же `.env` (`--env-file=.env`).

### 4.2 Main loop (упрощённо)

```ts
async function mainLoop() {
  const runnerPid = process.pid;
  signalServer.start({ onWake: () => loopTick.fire() });

  while (!shuttingDown) {
    await loopTick.waitOrTimeout(POLL_INTERVAL_MS); // 5s default + immediate on /wake

    const job = await container.claimNextAgentJob.execute(runnerPid);
    if (!job) continue;

    // Fire-and-forget — параллельные job'ы пока global cap позволяет.
    runJobInBackground(job).catch(logErr);
  }

  await waitForInflightJobs();
}
```

### 4.3 Single-job executor (псевдокод)

```ts
async function executeJob(job: AgentJob) {
  const ctx = await prepareWorktree(job);            // git worktree add + branch
  try {
    await markStarted(job.id);
    const exitCode = await runClaude(ctx, job);      // spawn claude -p ... with timeout
    if (exitCode !== 0) throw new Error('Claude exited non-zero');

    const hasCommits = await hasCommitsAgainstMain(ctx.worktreePath, ctx.branch);
    if (!hasCommits) throw new Error('No changes produced');

    await gitPush(ctx);
    const prUrl = await ghCreatePr(ctx, job);
    await complete(job.id, { ok: true, prUrl, branchName: ctx.branch });
  } catch (e) {
    await complete(job.id, { ok: false, error: e.message, branchName: ctx.branch });
  } finally {
    await cleanupWorktree(ctx);
  }
}
```

`runClaude` — `spawn('claude', ['-p', prompt, '--permission-mode', 'acceptEdits', '--output-format', 'stream-json'])`, со stdin закрытым, stdout/stderr → лог-файл, timeout через `AbortController`.

### 4.4 Промпт

Билдер в `prompt.ts`:

```ts
export function buildAgentPrompt(input: { project: Project; task: Task; repoUrl: string }): string {
  return `Ты автономный coding-агент. Тебе отдали задачу из ProjectsFlow.

ПРОЕКТ: ${input.project.name}
REPO: ${input.repoUrl}
TASK ID: ${input.task.id}

ОПИСАНИЕ ЗАДАЧИ:
${input.task.description ?? '(пусто)'}

ИНСТРУКЦИИ:
1. Прочитай задачу. Если она требует уточнения, которое нельзя получить из кода — заверши работу
   без коммитов: "Cannot proceed without clarification: ...".
2. Изучи репо. Используй MCP tool pf_get_task если у задачи attachmentCount > 0.
3. Сделай минимально достаточные изменения. Никакого scope creep.
4. Закоммить с осмысленным сообщением.
5. НЕ пушь и НЕ открывай PR — runner сделает это сам после твоего выхода.

ПРАВИЛА:
- CLAUDE.md в репо — обязательно к прочтению. Следуй ему.
- Не трогай файлы вне scope задачи.
- Если есть тесты — запусти их перед коммитом. Не падают → коммить. Падают → не коммить, опиши проблему в задаче через pf_create_task (новая задача-followup).
- Без --no-verify, без скрытия проблем.

Когда закончишь — просто выйди (Ctrl-D / завершить турн без вопросов).`;
}
```

`acceptEdits` permission-mode позволяет Claude'у Edit/Write без подтверждения, но НЕ позволяет destructive Bash — это намеренно. Push и PR делает не Claude, а runner.

### 4.5 Cancellation

`CancelAgentJob` use-case:
- `status=queued` → просто `UPDATE ... SET status='cancelled'`. Runner проверит при claim'е и пропустит.
- `status=running` → POST `/cancel/:job_id` на signalServer. signalServer находит inflight-process по job_id в registry, шлёт `SIGTERM`, ждёт до 10s graceful exit, потом `SIGKILL`. После — обычный `complete(id, { ok: false, error: 'cancelled by user' })`.

Branch и worktree чистятся всегда в `finally`, push/PR не происходят если процесс убит до `gitPush`.

---

## 5. HTTP endpoints

### 5.1 Внутренний agent-routes

`server/src/presentation/agent-jobs/routes.ts`:

```
POST   /api/projects/:projectId/tasks/:taskId/agent      — enqueue job
DELETE /api/projects/:projectId/agent-jobs/:jobId        — cancel job
GET    /api/projects/:projectId/agent-jobs               — list (для UI)
GET    /api/projects/:projectId/agent-jobs/:jobId        — детали + tail лога
GET    /api/projects/:projectId/agent-jobs/:jobId/log    — full log (text/plain stream)
```

Все требуют session-cookie (existing `requireSession` middleware) + permissions check через `can(role, 'delegate_task_to_agent')`.

Endpoint `/log` — последний tail из файла, для UI «открыть лог».

### 5.2 Расширение `/api/projects/:id/tasks`

Существующий endpoint начинает возвращать вложенный `agentJob` для задач с активной job'ой:

```jsonc
{
  "tasks": [
    {
      "id": "...",
      "status": "todo",
      "delegatedToAgent": true,
      "agentJob": {
        "id": "...",
        "status": "running",
        "prUrl": null,
        "startedAt": "2026-05-21T10:00:00Z"
      },
      ...
    }
  ]
}
```

UI смотрит на наличие `agentJob` + его `status`, не на `delegatedToAgent` (флаг sticky, см. секцию 2.2).

---

## 6. UI

### 6.1 KanbanCard

Новый dropdown-menu item «🤖 Отдать агенту» — только для:
- `status === 'todo'`,
- `agentJob` отсутствует или его `status` ∈ `succeeded`/`failed`/`cancelled`,
- `can(currentRole, 'delegate_task_to_agent')`.

Клик → POST на enqueue endpoint → onSuccess запускает polling tasks-листа (через `useTasks` invalidate).

### 6.2 Badge на карточке при активной job

Под description-текстом карточки:

| `agentJob.status` | Бейдж | Действия |
|---|---|---|
| `queued` | «🤖 В очереди» (серый) | «Отменить» |
| `running` | «🤖 Работает 12m» (синий, с тикающим таймером) | «Лог», «Отменить» |
| `succeeded` | «🤖 PR #42» (зелёный, ссылка на pr_url) | «Лог» |
| `failed` | «🤖 Ошибка» (красный, hover → tooltip с error) | «Лог», «Повторить» |
| `cancelled` | «🤖 Отменено» (серый) | «Лог» |

«Повторить» = новая job на ту же task. Бейдж `succeeded`/`failed` остаётся видимым до перехода задачи в `done` или ручного reset'а.

### 6.3 Polling

`useTasks` уже опрашивает endpoint при изменениях. Добавляем `setInterval(refetch, 5000)` если есть активные job'ы (`queued`/`running`) — иначе не опрашиваем. Раз есть активная — каждые 5s до её ухода в терминальный статус.

### 6.4 Лог-просмотрщик

Простой модал «Лог агента». Внутри `<pre>` с содержимым `/log` endpoint'а. Если job ещё `running` — добавляем `setInterval(refetch, 3000)`. Без подсветки, без парсинга stream-json — просто текст.

---

## 7. Конфигурация

Новые env-переменные:

| Переменная | Default | Назначение |
|---|---|---|
| `RUNNER_ENABLED` | `false` | Главный switch. На dev-машинах оставляем `false`, runner-процесс не стартует. |
| `RUNNER_GLOBAL_CAP` | `2` | Сколько job'ов параллельно глобально. |
| `RUNNER_POLL_INTERVAL_MS` | `5000` | Запасной poll-интервал на случай потерянного wake-сигнала. |
| `RUNNER_SIGNAL_PORT` | `4318` | Порт мини-сигнал-сервера (localhost only). |
| `RUNNER_JOB_TIMEOUT_MS` | `1800000` | 30 минут на одну job'у. |
| `RUNNER_WORKSPACE_DIR` | `/var/www/projectsflow/agent-workspaces` | Где create'ятся worktree'и. |
| `RUNNER_LOG_DIR` | `/var/log/projectsflow-runner` | Куда пишутся stdout/stderr Claude'а. |
| `CLAUDE_BIN` | `claude` | Путь к Claude Code CLI. На сервере нужно установить отдельно (см. секцию 9). |
| `GH_TOKEN` | — | GitHub PAT с правами `repo` для `gh pr create`. **REQUIRED** если `RUNNER_ENABLED=true`. |
| `ANTHROPIC_API_KEY` | — | Для Claude headless. **REQUIRED** если `RUNNER_ENABLED=true`. |
| `RUNNER_AGENT_TOKEN` | — | Существующий `pfat_…` agent-token для MCP. **REQUIRED**. |

В `.env.example` — все добавляем с пустыми значениями + комментариями.

---

## 8. Безопасность и blast radius

### Что может пойти не так

1. **Агент пушит что-то ломающее в main.** Митигация: PR-only, никогда не push в `main` напрямую, PR создаётся в `--draft`-режиме, требуется ручной approval + merge.
2. **Агент сжирает API-кредиты.** Митигация: timeout 30 мин на job, global cap = 2 параллельных, max ~120 job/день (если runner всегда занят).
3. **Агент видит чужие проекты через MCP.** Митигация: `RUNNER_AGENT_TOKEN` принадлежит определённому юзеру. Если в `agent_jobs` лежит job на проект, к которому этот юзер не имеет доступа — нельзя его запускать. Бэкенд проверяет `can(role, 'read_project')` для `agent_jobs.created_by` на момент **claim'а**, не enqueue'а — потому что роли могут отозвать пока job в очереди.
4. **Worktree-leak.** Митигация: cleanup в `finally`, плюс startup-задача runner'а: `git worktree prune` + `rm -rf` для всех старых workspaces.
5. **Утечка секретов в логи.** Митигация: лог-файлы только локально, не в БД (БД хранит tail только при `failed`, max 4KB, проходит через redact-функцию по списку patterns: `pfat_*`, `gh*`, `sk-*`).
6. **DoS через webhook.** Митигация: enqueue endpoint требует session-cookie + editor-role; rate-limit (existing middleware) 60 req/min/user.

### Что НЕ митигируем в v1

- **Агент-runaway**: Claude уходит в бесконечный цикл и зачем-то отправляет 50 запросов в минуту. Митигация частичная — timeout 30 мин. Жёсткий cap по токенам — отдельная спека (cost-tracking).
- **GitHub API rate-limit**: при 2 параллельных агентах + 10 job/час это нерелевантно. Если упрёмся — увидим в логах, добавим backoff.
- **Compromised agent-token**: revoke в UI, как для любого agent-token'а.

---

## 9. Установка Claude CLI на сервере

Headless `claude` нужно установить отдельно от npm-зависимостей проекта (это desktop-приложение Anthropic):

```bash
# на сервере, от юзера projectsflow
curl -fsSL https://claude.ai/install.sh | sh
# либо npm-вариант, если доступен
npm install -g @anthropic-ai/claude-code
claude --version  # проверить
claude config set apiKey "$ANTHROPIC_API_KEY"  # авторизация через env-var
```

MCP `@projectsflow/mcp-server` устанавливается в global Claude config один раз:

```bash
claude mcp add --scope user projectsflow -- npx -y @projectsflow/mcp-server@latest
```

Token MCP'а — это `RUNNER_AGENT_TOKEN`. Он лежит в `~/.config/projectsflow/agent.json` (см. `mcp-server/src/config.ts`).

Этот шаг **не делает npm run deploy**. Отдельный документ в [docs/ONBOARDING.md](docs/ONBOARDING.md) — раздел «Установка runner'а» (создать в рамках реализации).

---

## 10. Open questions

Решить до выхода в P1:

1. **Cancel-flow для PR**: если юзер отменяет job, который уже создал PR — надо ли закрывать PR через `gh pr close`? **Предложение**: да, закрываем + удаляем branch. Хочется чистоты.
2. **Re-queue после failed**: пока ручной retry через UI. Достаточно? **Предложение**: да, в v1 без auto-retry.
3. **Worktree-storage size**: каждый worktree — это копия репо, ~50-500MB. При 10 параллельных = 5GB. На VPS 40GB диска это ок? **Нужно проверить**: `df -h /var/www`. Если узко — лимит на cleanup-aggressive (`git worktree remove --force` сразу после job'а, не lazy).
4. **Лог-ротация**: `/var/log/projectsflow-runner/*.log` будет копиться. **Предложение**: cron-задача `find ... -mtime +30 -delete` раз в сутки. Не в spec, добавляем в onboarding.
5. **Concurrency двух runner-процессов**: если случайно запустим два runner'а (через PM2 `instances: 2`) — `SELECT FOR UPDATE SKIP LOCKED` спасёт от двойного claim'а, но `runner_pid` будет от одного из них. Cancel может промахнуться. **Решение**: явно прописать в PM2-конфиге `instances: 1`, exec_mode `fork`, не cluster.
6. **Что если задача не имеет описания (`description IS NULL`)?** **Предложение**: enqueue endpoint отвечает 400 «нечего отдавать агенту, добавьте описание». В UI — кнопка disabled с tooltip'ом.

---

## 11. Что ломается / migration impact

- **API contract**: `/api/projects/:id/tasks` начинает возвращать дополнительное поле `agentJob` на task'ах. Существующие клиенты игнорируют unknown fields — не ломается.
- **Drizzle schema**: добавляются 2 таблицы + 1 колонка. Drift-checker должен сразу подцепить.
- **Permissions**: новые actions в `permissions.ts`. Полный TS-checking покажет если где-то забыли — TS-енам строгий.
- **MCP-сервер**: **не меняется**. Runner использует те же `pf_*` tool'ы что и человек из Claude Code.
- **Deploy**: новый PM2-процесс. `ecosystem.config.cjs` обновится. **Первый деплой после Spec — на проде**: `RUNNER_ENABLED=false`, всё работает как раньше, выкатываем миграции + код, потом отдельно опускаем env-flag в `true`.

---

## 12. Чеклист P1 (минимальный e2e)

Что должно работать после первой реализации, прежде чем выкатывать на прод:

- [ ] Миграции 014 + 015 применяются на чистой БД без ошибок.
- [ ] Кнопка «Отдать агенту» в UI создаёт `agent_jobs(status='queued')`.
- [ ] Cancel queued-job переводит в `cancelled`, агент не подхватывает.
- [ ] Запущенный runner-процесс (с `RUNNER_ENABLED=true`) клеймит queued-job в течение 5s.
- [ ] Claude отрабатывает на простой задаче («измени README.md, добавь строку») → PR создаётся.
- [ ] Job в БД переходит в `succeeded`, `pr_url` заполнен, UI показывает зелёный бейдж.
- [ ] Cancel running-job убивает Claude-процесс, worktree удаляется, job → `cancelled`.
- [ ] Job, превысивший timeout, переходит в `failed` с `error='timeout'`.
- [ ] Permission-check: не-member проекта не может enqueue'ить job (403).
- [ ] Permission-check: viewer не может enqueue'ить job (403).
- [ ] Two concurrent jobs в разных проектах исполняются параллельно. Два в одном — последовательно.
- [ ] Global cap = 1 → второй job ждёт первого.

Только после прохождения чеклиста — деплой и `RUNNER_ENABLED=true` на проде.
