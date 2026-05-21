# Spec: Kanban Agent Runner — авто-выполнение TODO-задач через Claude Code /loop

**Дата:** 2026-05-21
**Статус:** Утверждён (брейншторм + revision), готов к плану реализации Plan B
**Зависит от:** Текущий MCP-сервер (`@projectsflow/mcp-server`), Spec #5 (Multi-tenant projects), Plan A backend (`agent_jobs` schema + UI кнопка)
**Открывает дорогу для:** Scheduled-агенты (cron), cost-tracking, multi-step задачи

> **Архитектурный пивот 2026-05-21.** Изначально (первая версия этой спеки) Plan B описывал
> отдельный PM2-daemon на VPS, который через `spawn claude -p` исполнял бы задачи.
> После cost-analysis (Anthropic API ≈ $30–300/мес активного использования) и обнаружения
> что Anthropic ToS запрещает использовать Pro/Max-подписку для headless processes,
> архитектура переписана на **client-side /loop**: юзер локально открывает Claude Code,
> запускает `/loop` slash-команду, сессия идёт через OAuth-подписку (подписка legitimate
> потому что Claude Code — interactive). Daemon-вариант сохранён в git-истории как rejected
> alternative.

---

## 1. Контекст и scope

### Зачем сейчас

У нас уже есть MCP-сервер, который даёт Claude Code доступ к kanban-задачам через
tool'ы `pf_list_tasks` / `pf_get_task` / `pf_link_commit_to_task` / `pf_create_task_comment`.
Но **триггер у этого flow всегда юзер** — он сидит в Claude Code, говорит «возьми задачу X»,
Claude её делает.

Хочется обратной стороны: юзер кладёт задачу в TODO, ставит флаг «отдать агенту», уходит
пить кофе. На стороне юзера крутится Claude Code сессия с `/loop`, которая:
1. Опрашивает MCP — есть ли pending agent-job'ы?
2. Если есть — атомарно claim'ит одну, помечает running.
3. Через MCP читает task, делает изменения в локальной копии репо, создаёт PR на GitHub.
4. Помечает job done (с pr_url) или failed.
5. Юзер видит PR в GitHub и зелёный бейдж на доске.

Эта спека описывает **Plan B v2 — /loop architecture**. Plan A (backend foundation: схема
БД, UI-кнопка, agent_jobs очередь, endpoints для enqueue/cancel/list) уже сделан и
описан в `docs/superpowers/plans/2026-05-21-kanban-agent-runner-backend.md`.

### Что ВНУТРИ scope

**Plan A — уже сделано (отдельный план):**
- Колонка `tasks.delegated_to_agent` (sticky-флаг).
- Таблица `agent_jobs (id, project_id, task_id, status, attempt, claimed_at, started_at, finished_at, error, pr_url, branch_name, runner_pid, created_by, created_at, updated_at)`.
- UI: кнопка «Отдать агенту» на TODO-карточке + `AgentJobBadge` со статусом + polling `/api/projects/:id/tasks` каждые 5s пока есть active job.
- HTTP endpoints (session-cookie): POST `/agent` enqueue, DELETE `/agent-jobs/:id` cancel, GET `/agent-jobs` list. Расширение GET `/tasks` inline `agentJob`.
- Permissions: `delegate_task_to_agent`, `cancel_agent_job` actions (`editor+`).
- `EnqueueAgentJob.execute` атомарно ставит `delegated_to_agent=true` + insert `agent_jobs` в одной транзакции.

**Plan B v2 — новое (эта спека):**

**Новые MCP-tool'ы** (в `@projectsflow/mcp-server`):
- `pf_list_pending_agent_jobs` — top-N queued job'ов по всем проектам юзера. Каждая job содержит
  `{id, projectId, projectName, taskId, taskDescription, createdAt, gitRepoUrl}`. Сортировка по
  `createdAt` asc. Используется агентом в /loop-промпте, чтобы выбрать что подхватить.
- `pf_claim_agent_job(jobId)` — атомарный pickup: UPDATE `agent_jobs` SET status='running', runner_pid=NULL, claimed_at=NOW() WHERE id=? AND status='queued'. Возвращает обновлённый job. Если уже claim'нута (status≠queued) — 409 Conflict с описанием.
- `pf_complete_agent_job(jobId, ok, prUrl?, error?, branchName?)` — финализация. `ok=true` → status='succeeded', `pr_url` заполнен. `ok=false` → status='failed', error заполнен. Так же UPDATE'ит `finished_at`.

**Новые server endpoints** (под `requireAgentToken`):
- GET `/api/agent/pending-agent-jobs?limit=10`
- POST `/api/agent/agent-jobs/:jobId/claim`
- POST `/api/agent/agent-jobs/:jobId/complete` с body `{ok: boolean, prUrl?: string, error?: string, branchName?: string}`

**Slash-command** в `~/.claude/commands/check-agent-queue.md` (либо в `~/.claude/projects/<repo>/commands/`) — markdown-файл с детальным промптом «что делать на каждом /loop-тике». В нём Claude инструктируется:
1. Вызвать `pf_list_pending_agent_jobs`. Если пусто — сразу выйти ("ничего не делать"), не тратить tool-budget.
2. Если есть кандидаты — выбрать первый, вызвать `pf_claim_agent_job(id)`. Если 409 — пропустить.
3. Через `pf_get_task(projectId, taskId)` получить полный контекст (description, attachments, comments thread).
4. Сделать `git fetch origin && git switch -c agent/<short-id>-<slug>` в локальной копии репо (агент должен заранее иметь это репо клонированным локально).
5. Реализовать задачу. Commit с осмысленным сообщением. Если задача требует уточнения — НЕ коммитить, вызвать `pf_create_task_comment` с описанием blocker'а + `pf_complete_agent_job(jobId, ok=false, error="needs clarification")`.
6. `git push origin <branch>` + `gh pr create --draft --title "..." --body "..."`.
7. `pf_create_task_comment(jobId task, "PR #N открыт — <url>")`.
8. `pf_complete_agent_job(jobId, ok=true, prUrl=<url>, branchName=<branch>)`.
9. Выйти. Следующий /loop-тик подхватит следующую job (если есть).

**Запуск (юзер):**
```
/loop 10m /check-agent-queue
```

Это значит: каждые 10 минут Claude Code посылает себе промпт `/check-agent-queue`. /loop живёт пока открыт терминал.

### Что СНАРУЖИ scope (следующие спеки)

| Тема | Куда |
|---|---|
| Auto-merge PR на основе CI | Отдельная — нужна интеграция с GitHub Actions, политика approval |
| Multi-step задачи (план → подтверждение → exec) | Отдельная, в v1 агент идёт от описания до PR одним thread'ом |
| Streaming прогресса агента в UI в реальном времени | Отдельная — потребует SSE-канал |
| Запуск агента на чужом репо (не GitHub) | Отдельная — нужна абстракция над PR-провайдером |
| Cost-tracking и budget-лимиты | Отдельная — нужна метрика «токенов на job» которая в /loop не очевидна, потому что подписка |
| Retry политика для `failed` | Отдельная — в v1 только manual retry (юзер опять жмёт «Отдать агенту») |
| Scheduled-agents (cron) | Отдельная — нужно перевести на server-side scheduler |
| Headless server runner (вернуть PM2-daemon если понадобится) | Отдельная — теоретическая возможность, не делаем сейчас |
| Multi-user execution (per-user agent identity) | Отдельная — нужна модель «агент работает от имени юзера X» с per-user токенами |

---

## 2. Изменения схемы БД

**Никаких новых миграций в Plan B v2.** Plan A уже добавил `agent_jobs` (миграция 014) и `tasks.delegated_to_agent` (миграция 015). /loop-архитектура работает на той же схеме.

Поле `runner_pid` в `agent_jobs` теряет смысл (нет процесса с PID на стороне сервера — есть только claim метка). Оставляем — может пригодиться для будущего headless-runner'а, и стоимость хранения нулевая.

---

## 3. Application-слой

### 3.1 Новые use-cases

```
server/src/application/agent/
  ListPendingAgentJobs.ts       — port: возвращает queued jobs across all user's projects
  ClaimAgentJob.ts              — атомарный claim
  CompleteAgentJob.ts           — финализация (success или fail)
```

`AgentJobRepository` port расширяется тремя методами:

```ts
export type AgentJobRepository = {
  ...existing methods (createForDelegation, findById, findActiveByTaskId, listForProject, cancel, ...),

  /**
   * Все queued job'ы по проектам, где юзер — member. Сортировка createdAt asc.
   * Limit — для UI/MCP (≈10-50). Без агрегации с tasks/projects — это делает use-case.
   */
  listPendingForUser(userId: string, limit: number): Promise<AgentJob[]>;

  /**
   * Атомарный claim — UPDATE WHERE id=? AND status='queued' SET status='running'.
   * Возвращает обновлённую job если apply удался (affected_rows=1), либо null
   * (job уже claim'нута / отменена / не существует).
   */
  claimById(jobId: string): Promise<AgentJob | null>;

  /**
   * Уже существующий `complete` (был для daemon-сценария) — переиспользуем.
   * Сигнатура неизменна.
   */
};
```

Старый `claimNext(globalCap, runnerPid)` метод (stub из Plan A) **удаляется** — в /loop-архитектуре не нужен.

### 3.2 ListPendingAgentJobs

```ts
type Deps = {
  readonly members: ProjectMemberRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly agentJobs: AgentJobRepository;
};

export type PendingAgentJobDto = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly gitRepoUrl: string | null;
  readonly taskId: string;
  readonly taskDescription: string | null;
  readonly createdAt: Date;
};

export class ListPendingAgentJobs {
  async execute(userId: string, limit: number): Promise<PendingAgentJobDto[]> {
    const jobs = await this.deps.agentJobs.listPendingForUser(userId, limit);
    // Repo-implementation сама делает JOIN'ы для project/task — иначе N+1 запросов.
    // Use-case только обогащает domain объектами.
    return jobs.map((j) => ({ ... })); // подробности зависят от того как repo вернёт
  }
}
```

Permission-check: репозиторий сам фильтрует по project_members. Use-case дополнительно не проверяет — лишний раунд-трип.

### 3.3 ClaimAgentJob

```ts
type Deps = {
  readonly members: ProjectMemberRepository;
  readonly agentJobs: AgentJobRepository;
};

export class ClaimAgentJob {
  async execute(input: { userId: string; jobId: string }): Promise<AgentJob> {
    // 1. Прочитать job чтобы знать projectId — нужно для permissions
    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job) throw new AgentJobNotFoundError(input.jobId);

    // 2. Проверить что юзер — editor+ на этом проекте.
    // КРИТИЧНО: проверка на момент claim'а, не enqueue'а — юзер мог быть удалён
    // из проекта пока job стояла в очереди.
    const membership = await this.deps.members.findForProject(job.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError(job.projectId);
    if (!can(membership.role, 'delegate_task_to_agent')) {
      throw new InsufficientProjectRoleError(membership.role, 'delegate_task_to_agent');
    }

    // 3. Атомарный claim
    const claimed = await this.deps.agentJobs.claimById(input.jobId);
    if (!claimed) {
      // race condition — кто-то другой захватил между findById и claimById
      throw new AgentJobAlreadyClaimedError(input.jobId);
    }
    return claimed;
  }
}
```

Нужен новый domain-error `AgentJobAlreadyClaimedError` (HTTP 409).

### 3.4 CompleteAgentJob

```ts
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
  async execute(input: CompleteAgentJobInput): Promise<void> {
    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job) throw new AgentJobNotFoundError(input.jobId);

    const membership = await this.deps.members.findForProject(job.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError(job.projectId);
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

Новый domain-error `AgentJobNotInRunningStateError` (HTTP 409).

### 3.5 DrizzleAgentJobRepository: реализация новых методов

```ts
async listPendingForUser(userId: string, limit: number): Promise<AgentJob[]> {
  // JOIN agent_jobs ↔ project_members WHERE pm.user_id=? AND aj.status='queued'
  // ORDER BY aj.created_at ASC LIMIT ?
  // Чтобы избежать N+1 в use-case'е — возвращаем сразу с project/task контекстом
  // через JOIN. Возвращаемый тип нужно расширить либо отдельным типом
  // PendingAgentJobRow с дополнительными полями.
}

async claimById(jobId: string): Promise<AgentJob | null> {
  const result = await this.db
    .update(agentJobs)
    .set({ status: 'running', startedAt: sql`CURRENT_TIMESTAMP`, claimedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(agentJobs.id, jobId), eq(agentJobs.status, 'queued')));
  // affectedRows проверка зависит от Drizzle/mysql2 driver:
  // если rows[0].affectedRows === 0 — не сделали claim
  if ((result as any).rowsAffected === 0) return null;
  return this.findById(jobId);
}
```

Drizzle для MySQL возвращает `[rowsAffected, ...]` или `[ResultSetHeader]` в зависимости от версии — нужно проверить шаблон, который уже используется в репо.

---

## 4. Agent execution model (/loop)

### 4.1 Где запускается

**На локальной машине юзера**, не на сервере. Юзер открывает Claude Code (desktop app или CLI) в директории своего проекта-консумента (или специальной директории-агрегатора, см. ниже), запускает:

```
/loop 10m /check-agent-queue
```

`/loop` — superpowers skill, повторяет указанную команду каждые 10 минут.
`/check-agent-queue` — кастомный slash-command, описанный ниже.

Сессия живёт пока открыт терминал. Закрытие = pause. Перезапуск возвращает с того же места — состояние сохраняется в `agent_jobs` БД.

### 4.2 Где живёт код, который агент трогает

Два варианта setup:

**A) «Один репо на сессию»** — юзер сидит в `c:\www\ProjectsFlow\` и /loop работает только над job'ами этого репо. Простой, но не масштабируется на multi-project.

**B) «Workspace-агрегатор»** — отдельная директория `~/agent-workspace/` содержит clone'ы всех репо, к которым может прикасаться агент:
```
~/agent-workspace/
  ProjectsFlow/        ← git clone https://github.com/djdes/ProjectsFlow
  OrdersFlow/
  Scanflow/
  ...
```
/loop запускается из `~/agent-workspace/`. Slash-command делает `cd <repoSlug>` исходя из `gitRepoUrl` job'ы. Масштабируется.

В v1 предпочитаем (B). Юзер заранее клонирует репо в `~/agent-workspace/`. Slash-command документирует это требование.

### 4.3 check-agent-queue slash-command

Файл `~/.claude/commands/check-agent-queue.md` (или per-project) — markdown с инструкциями. Полный текст в [§ 9: Установка](#9-установка-локально-claude-code--workspace).

Высокоуровневая структура:
1. Полл pending jobs через MCP.
2. Если пусто — exit без действий, не тратить tool-calls.
3. Иначе — claim первой, прочитать task, реализовать в worktree, push, PR, complete.
4. Между шагами — leave progress comments через `pf_create_task_comment` (ritual из CLAUDE.md).

### 4.4 Concurrency и race conditions

**В рамках одной /loop-сессии:** последовательно — Claude обрабатывает один thread за раз, /loop ждёт его завершения перед следующим тиком.

**Между двумя сессиями (юзер на ноуте + на десктопе):** атомарный `pf_claim_agent_job` через SQL `UPDATE WHERE status='queued'` защищает от двойного pickup'а. Один из двух получит 409, нормально пропустит.

**Cancel в процессе работы:** юзер может перетащить кнопку «Отменить» в UI на job со status='running'. UI вызывает existing `CancelAgentJob` use-case → `agent_jobs.status='cancelled'`. Агент в /loop об этом узнает только если **сам периодически проверяет** через MCP (т.е. при следующем `pf_get_task` или явно через `pf_get_agent_job` если такой добавим). В v1 — **не митигируем**: агент может закончить работу и попытаться вызвать `pf_complete_agent_job`, который вернёт 409 (status не running). Агент должен это обработать как «cancelled — отбрасываем PR, чистим worktree».

### 4.5 Promise/timeouts

Нет отдельного timeout на job — `/loop` сам ограничивает разумной паузой между тиками. Если задача затянулась на 30+ минут — это просто долгий ход внутри одной /loop-итерации, следующий тик не запустится пока этот не завершится.

Если хочется hard-cap на one-shot — slash-command может включать инструкцию «если не завершил за N минут — оставь comment и сдай как failed».

---

## 5. HTTP endpoints

### 5.1 Существующие (из Plan A, под session-cookie)

POST   /api/projects/:projectId/tasks/:taskId/agent        — enqueue job
DELETE /api/projects/:projectId/agent-jobs/:jobId          — cancel job
GET    /api/projects/:projectId/agent-jobs                 — list project jobs
GET    /api/projects/:projectId/tasks                       — теперь включает inline agentJob

### 5.2 Новые (Plan B v2, под `requireAgentToken`)

```
GET    /api/agent/pending-agent-jobs?limit=10
POST   /api/agent/agent-jobs/:jobId/claim
POST   /api/agent/agent-jobs/:jobId/complete
```

`requireAgentToken` middleware устанавливает `req.user` из owner'а агент-токена. Все три endpoint'а используют его для permissions.

**GET pending-agent-jobs:**
```jsonc
{
  "jobs": [
    {
      "id": "uuid",
      "projectId": "uuid",
      "projectName": "ProjectsFlow",
      "gitRepoUrl": "https://github.com/djdes/ProjectsFlow",
      "taskId": "uuid",
      "taskDescription": "...",
      "createdAt": "2026-05-21T10:00:00Z"
    }
  ]
}
```

**POST claim:** 200 + `{job: AgentJobDto}` или 409 `{error: "agent_job_already_claimed", message: "..."}`.

**POST complete:** body `{ok, prUrl?, error?, branchName?}` → 204 No Content. 409 если job не в running.

---

## 6. UI

UI **не меняется** в Plan B v2 относительно Plan A. Badge показывает статусы из `agent_jobs.status` — тот же flow. PR-ссылка появляется когда агент вызвал `pf_complete_agent_job(ok=true, prUrl)`. Comments thread виден когда юзер открывает карточку (если есть TaskDialog с comment list).

Опционально (можно отложить): подсказка в UI «есть N pending agent-job'ов, запусти /loop в Claude Code чтобы они начали исполняться». Не блокирующая, просто nudge. Out of scope v1.

---

## 7. Конфигурация

**На сервере:** ничего нового. RUNNER_ENABLED и RUNNER_SIGNAL_URL из Plan A — **удаляем** (или оставляем как dead config — они ничего не делают). Daemon-based env-vars `RUNNER_GLOBAL_CAP`, `RUNNER_JOB_TIMEOUT_MS`, `CLAUDE_BIN`, `ANTHROPIC_API_KEY`, `GH_TOKEN`, `RUNNER_AGENT_TOKEN`, `RUNNER_WORKSPACE_DIR`, `RUNNER_LOG_DIR` — **не нужны на сервере** в этой архитектуре.

**На локальной машине юзера** (где запускается /loop):

| Что | Где | Зачем |
|---|---|---|
| MCP-token | `~/.config/projectsflow/agent.json` или ENV `PROJECTSFLOW_AGENT_TOKEN` | Аутентификация в наш бэкенд через MCP |
| `gh` CLI auth | `gh auth login` (interactive, OAuth) | Создание PR через `gh pr create` |
| Git auth | SSH key или `gh auth git-credential` | `git push` в GitHub |
| Claude Code | взято с подпиской Pro/Max через `claude login` (OAuth) | API-кредиты для самой LLM |
| Workspace | `~/agent-workspace/<repoSlug>/` с git clone каждого репо | Где агент делает изменения |

Юзер настраивает один раз — переживает рестарты компа.

---

## 8. Безопасность и blast radius

### Что может пойти не так

1. **Агент пушит что-то ломающее в `main`.** Митигация: slash-command инструктирует создавать только feature-branch и `gh pr create --draft`. PR требует ручного approval+merge. Никаких force-push.
2. **Агент захватывает чужой PR / трогает чужие branch'и.** Митигация: slash-command всегда делает `git switch -c agent/<short-job-id>-<slug>` — уникальный branch на каждую job. Не трогает существующие.
3. **Агент читает credentials из репо.** Митигация: репо не должен содержать секреты в plaintext (общее правило). Vault через MCP `pf_get_credential` — даёт plaintext, но только под Bearer-token того юзера который запустил /loop. Это **очень мощный токен** — кто получил MCP-token, получил доступ к vault.
4. **MCP-token compromise.** Митигация: revoke в UI «Доступ для агентов». После revoke /loop падает с 401 на следующем тике, юзер видит ошибку.
5. **Кто-то перехватил `gh` или GitHub SSH.** Митигация: стандартная — 2FA, hardware key. Не специфично для агента.
6. **Агент-runaway: thread всё растёт, не завершается.** Митигация: подписка Pro/Max имеет rate-limit (5h cap на messages). Если /loop забивает rate — следующие тики просто не отработают, юзер увидит "rate limited" в Claude Code.

### Что НЕ митигируем в v1

- **Multi-user agent identity.** Все коммиты от identity того юзера, чей MCP-токен в /loop. Per-user runner — отдельная спека.
- **Cost-cap.** Подписка фикс-плата, runaway не приведёт к биллинг-сюрпризу — только rate-limit'ы.
- **Compromised local machine.** Если кто-то получил доступ к компу юзера — у них есть всё: SSH-keys, gh-credentials, MCP-token, открытая Claude Code сессия. Это не специфично для агента.
- **Запуск /loop на чужой машине через RDP/SSH.** Если юзеру нужно — пусть запускает.

### Кардинальная разница vs daemon-вариант (rejected)

Daemon выполнял `claude -p` от системного юзера на VPS, что означало:
- API key Anthropic в env-vars на сервере — реальный billing-аккаунт.
- `GH_TOKEN` на сервере — PAT с правами repo.
- Сервер компрометируется = всё это утекает.

/loop же:
- Использует **подписку юзера** (OAuth credentials в `~/.claude/`).
- Использует **локальный `gh` auth** юзера.
- Использует **локальный SSH** юзера.
- Сервер ProjectsFlow знает только сам MCP-token (один из многих у юзера).

То есть blast radius **на порядок меньше** — сервер не имеет ни Claude credentials, ни GitHub PAT, только координационную метаданные.

---

## 9. Установка (локально: Claude Code + workspace)

### 9.1 Pre-requisites

- Claude Code CLI или desktop app, залогинен через `claude login` (Pro/Max).
- `gh` CLI, залогинен через `gh auth login`.
- Git, SSH key в GitHub.
- MCP-token ProjectsFlow в `~/.config/projectsflow/agent.json` (через `npx -y @projectsflow/mcp-server setup`) или env-vars.

### 9.2 Workspace setup

```bash
mkdir -p ~/agent-workspace && cd ~/agent-workspace
gh repo clone djdes/ProjectsFlow
gh repo clone djdes/OrdersFlow
# ... все репо к которым может прикасаться агент
```

В каждом clone'е сделать `git config user.email "agent@<твой_email>"` и `git config user.name "<твоё имя> (agent)"` — чтобы коммиты от агента визуально отличались. Опционально.

### 9.3 Slash-command

Создать `~/.claude/commands/check-agent-queue.md` со следующим содержимым:

```markdown
---
description: Polls ProjectsFlow agent queue and executes one pending job
---

Ты — agent runner. Каждый раз когда я тебя зову, делай:

## 1. Опрос

Вызови `pf_list_pending_agent_jobs(limit=10)`.

Если массив пустой — выходи сразу с одной строкой ответа:
> Нет pending agent-job'ов. Жду следующего тика.

НЕ делай больше никаких tool-calls, не пиши размышления — это пустой тик, не тратим budget.

## 2. Pick & claim

Если в массиве 1+ job'ов — возьми ПЕРВУЮ (она самая старая). Запиши `jobId`, `projectId`, `projectName`, `gitRepoUrl`, `taskId`, `taskDescription`.

Вызови `pf_claim_agent_job(jobId)`.

- Если вернулось 409 / "already claimed" — другая сессия захватила. Выходи с сообщением:
  > Job <id> already claimed by another session. Skipping.

- Если 200 — продолжай.

Сразу же вызови `pf_create_task_comment(projectId, taskId, "🤖 Беру в работу. План: …")` с кратким планом подхода (1-3 строки).

## 3. Read full context

Вызови `pf_get_task(projectId, taskId)`. Прочитай:
- `task.description` — что нужно сделать.
- `attachments` — скриншоты/файлы. Картинки сразу видишь как image-блоки.
- `comments` — прошлые обсуждения. Если в последних комментах юзер уточнял scope — учти.

Если задача **неоднозначна** или требует решения которое нельзя принять самостоятельно:
1. `pf_create_task_comment(projectId, taskId, "Не могу продолжить: <конкретный вопрос>. @<userDisplayName>")` — упомяни автора задачи, придёт notification.
2. `pf_complete_agent_job(jobId, ok=false, error="needs clarification: <question>")`.
3. Выйди.

## 4. Implement

Определи slug репозитория из `gitRepoUrl` (последний segment URL).

```bash
cd ~/agent-workspace/<repoSlug>
git fetch origin
git switch main && git pull --ff-only origin main
git switch -c agent/<jobId-первые-8>-<slugify(description первые 40 chars)>
```

Прочитай `CLAUDE.md` в репо — обязательно. Следуй его правилам.

Реализуй задачу:
- Минимально достаточные изменения. Никакого scope creep.
- Если есть тесты — запусти. Падают → не коммить, идём в Section 6 как failure.
- Commit с осмысленным сообщением. Формат: `<type>(<scope>): <subject>` если репо так коммитит.

## 5. Push & PR

```bash
git push origin <branch>
gh pr create --draft \
  --title "<task description первые ~60 chars>" \
  --body "Closes agent job <jobId>.

<task.description>

Agent commit summary:
- <bullet 1>
- <bullet 2>"
```

Сохрани `prUrl` из stdout `gh pr create`.

Вызови `pf_create_task_comment(projectId, taskId, "PR #<N> открыт: <prUrl>")`.

Вызови `pf_complete_agent_job(jobId, ok=true, prUrl=<url>, branchName=<branch>)`.

Выйди с сообщением:
> ✅ Job <jobId> done. PR: <url>

## 6. Failure path

Если на любом шаге (4 или 5) что-то падает — commit failed, push failed, gh pr create failed:

1. Постарайся понять причину из ошибки.
2. Если можно retry в этом же thread'е — попробуй один раз.
3. Если нет — откати: `git switch main && git branch -D agent/<branch>`.
4. `pf_create_task_comment(projectId, taskId, "🤖 Не получилось: <одно-два предложения о причине>")`.
5. `pf_complete_agent_job(jobId, ok=false, error="<message>", branchName=<branch_если_был>)`.
6. Выйди.

## Правила (повторно)

- Один /loop-тик = одна job (или пустой тик).
- НЕ трогай чужие branch'и или main directly.
- НЕ force-push.
- НЕ запускай агента на репо без CLAUDE.md или без описания задачи.
- Comments на task — кратко, по делу.
```

### 9.4 Запуск

```
cd ~/agent-workspace
claude
> /loop 10m /check-agent-queue
```

`10m` — интервал между тиками. Меньше — частые проверки, больше burn rate подписки. Больше — медленнее реакция. **10–15 минут — sweet spot.**

---

## 10. Open questions

Решить до выхода в P1:

1. **Workspace location.** Где юзеру держать `~/agent-workspace/`? Зависит от OS и привычек. **Предложение:** `$HOME/agent-workspace/` (или `%USERPROFILE%\agent-workspace\` на Windows). Документируем как convention.

2. **Идентификация репо.** `gitRepoUrl` от `pf_list_pending_agent_jobs` приходит как полный URL. Slugify (например по last segment URL) на стороне slash-command'а или на стороне сервера? **Предложение:** на сервере — добавить поле `repoSlug` в DTO, чтобы slash-command'у не парсить URL.

3. **`agent_jobs.runner_pid` field.** В /loop-архитектуре нет PID процесса (хотя у Claude Code есть PID, но он не нужен для cancel). **Предложение:** оставить колонку NULL для всех новых job'ов. Не удаляем — может вернёмся к daemon позже. Дополнительная миграция не нужна.

4. **Re-queue после failed.** Юзер видит «Ошибка» badge с error message. Хочется ли кнопку «Повторить» в UI? **Предложение:** v1 — без auto-retry. Юзер вручную: кликает кнопку «Отдать агенту» ещё раз → создаётся новая job.

5. **`/loop` rate против подписки.** Pro даёт ~45 msgs / 5h при средней нагрузке. `/loop 10m` = 30 тиков / 5h. Если каждый тик что-то делает (не «nothing to do») — каждый сжигает несколько msg-budget'ов. **Предложение:** в slash-command'е agressive «nothing to do» exit — выход после одного tool-call'а если queue пустая. Это снижает burn rate до 1 msg/тик в idle.

6. **Concurrent /loop sessions (юзер на двух машинах).** Атомарный `claimById` решает race на стороне БД, но обе сессии будут polling'ить. **Предложение:** не митигируем — pure нагрузка на бэк (GET pending-agent-jobs) тривиальна.

7. **Что если юзер удалил MCP-token пока агент работает?** Следующий MCP-call (например `pf_complete_agent_job`) вернёт 401. Агент должен это поймать и просто завершить thread с ошибкой. PR останется висеть на GitHub в draft — юзер закроет руками. **Предложение:** документируем как expected behavior.

---

## 11. Что ломается / migration impact

- **Никаких новых миграций в Plan B v2.** Все изменения — на коде + новые MCP-tool'ы.
- **API contract:** новые endpoints под `/api/agent/*` — это **расширение** существующего agent-router'а, никакого breaking change.
- **MCP-server major bump:** **0.6.0 → 0.7.0** (новые tools `pf_list_pending_agent_jobs`, `pf_claim_agent_job`, `pf_complete_agent_job`). Семантически это minor (additive), но удобно поднять как 0.7.0 для маркировки этапа.
- **Plan A code:** `claimNext(globalCap, runnerPid)` stub в `DrizzleAgentJobRepository` и `AgentJobRepository` port — **удаляется**. В тех версиях Plan A где это `// TODO Plan B` — заменяется на новые методы `listPendingForUser` + `claimById`. Тесты Plan A не падают (там этот метод был stub'ом с null).
- **Permissions:** существующие actions `delegate_task_to_agent` и `cancel_agent_job` переиспользуются. Никаких новых.
- **Deploy:** новые endpoints + новые use-cases добавляются обычным `npm run deploy` (или GH Actions). Никаких новых PM2-процессов. Никакого RUNNER_ENABLED — этот env-var **удаляется** из `.env.example` (был добавлен в Plan A).

---

## 12. Чеклист P1 (минимальный e2e)

Что должно работать после Plan B v2:

**Backend:**
- [ ] Новые use-cases (`ListPendingAgentJobs`, `ClaimAgentJob`, `CompleteAgentJob`) компилируются.
- [ ] `AgentJobRepository.claimById` атомарен — конкурентный claim'ит ровно один из двух запросов.
- [ ] 3 новых endpoint'а отвечают корректно: GET pending → 200 list, POST claim → 200 или 409, POST complete → 204 или 409.
- [ ] Permissions: agent-token не-member'а проекта получает 403 при claim/complete.
- [ ] `RUNNER_ENABLED` и связанная dead config удалены из `.env.example` и `config.ts`.

**MCP server (`@projectsflow/mcp-server` 0.7.0):**
- [ ] 3 новых tool'а описаны в TOOLS массиве с правильным JSON-Schema.
- [ ] Handler'ы парсят входные параметры через zod, дёргают `api.*` методы.
- [ ] `api.ts` имеет соответствующие методы (listPendingAgentJobs, claimAgentJob, completeAgentJob).
- [ ] `npm publish` опубликовал 0.7.0 в npm registry.

**Slash-command:**
- [ ] Файл `~/.claude/commands/check-agent-queue.md` собран (полная версия из § 9.3).
- [ ] При запуске `/check-agent-queue` без pending — Claude выходит коротким сообщением.

**E2E:**
- [ ] Юзер создаёт задачу с описанием, жмёт «Отдать агенту» в UI — `agent_jobs` row появилась со status='queued'.
- [ ] В отдельном терминале `/loop 10m /check-agent-queue` подхватывает её в течение 10 минут.
- [ ] Claim атомарный — pf_claim_agent_job возвращает 409 при повторном вызове на ту же job.
- [ ] Агент пишет comment «беру в работу» на task.
- [ ] Агент работает в `~/agent-workspace/<repoSlug>/`, создаёт feature-branch, коммитит, push'ит, открывает draft-PR.
- [ ] pf_complete_agent_job обновляет status='succeeded' с pr_url.
- [ ] UI badge меняется с «В очереди» → «Работает» → «PR #N (зелёный)».
- [ ] При cancel'е через UI на running-job — на следующем complete'е получаем 409, агент чисто завершается (откатывает worktree).

Только после прохождения чеклиста — публикуем 0.7.0 на npm и пишем апдейт в `docs/ONBOARDING.md` про настройку локального workspace.
