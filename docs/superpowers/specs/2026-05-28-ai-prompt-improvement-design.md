# Spec: AI Prompt Improvement через Ralph-диспетчера

**Дата:** 2026-05-28
**Статус:** Draft, готов к реализации
**Зависит от:** Spec #6 (Kanban Agent Runner, `agent_jobs` infra), MCP-сервер `@projectsflow/mcp-server`, диспетчер per-project
**Открывает дорогу для:** Любые short-lived AI-задачи (резюме комментариев, авто-теги, генерация описаний коммитов), реализация той же фичи в любом другом проекте

---

## 1. Контекст и scope

### Зачем

Юзер при создании задачи часто пишет обрывочно («починить меню на мобиле»). В трекере это плохо читается, плохо ищется, и Ralph-диспетчеру тяжелее работать с такой постановкой. Хочется кнопку **«AI»** в формах создания задач — нажал, и текст переписался простыми словами + домыслил детали (шаги, критерии, edge-кейсы).

Если задача создаётся в проекте с подключённой базой знаний (KB) — AI должен учитывать KB-контекст (терминология, имена компонентов, конвенции). Если KB нет или задача идёт в Inbox — AI расширяет только сам текст.

### Архитектурное ограничение: без ANTHROPIC_API_KEY на сайте

Сайт ProjectsFlow **не должен** держать у себя ключ к Anthropic API. Причины:
- Anthropic-подписка живёт у конкретного юзера (admin@projectsflow.ru), а не у сервера-приложения.
- Хочется единую точку «куда уходят AI-запросы» — она уже есть в виде диспетчера (Ralph), у которого Claude Code подписка, MCP-доступ и стабильный `/loop`.
- В будущем другие проекты будут использовать тот же подход — заводить ключ в каждом overkill.

Поэтому: сайт **не вызывает Claude напрямую**, а помещает запрос в очередь (БД), которую опрашивает Ralph-диспетчер. Ralph пикапит, переписывает текст через свою Claude-сессию, возвращает результат в очередь. Фронт получает результат через long-poll.

### Что ВНУТРИ scope

- Кнопка **AI** в трёх местах создания задачи: `AddTaskDialog` (главный диалог), `QuickAddTodo` (быстрый ввод на колонке), `TaskDrawerComposer` (composer внутри drawer'а — для добавления подзадач, если такая логика будет; на момент v1 — там, где есть textarea).
- Новая БД-таблица `ai_prompt_jobs`.
- Server endpoints (session-cookie auth):
  - `POST /api/ai/prompt-jobs` — создать job, вернуть `{ jobId }`.
  - `GET /api/ai/prompt-jobs/:jobId?wait=25` — long-poll, держит соединение до 25 сек или до готовности; 504 при таймауте.
- Server endpoints (agent-token auth, для Ralph):
  - `GET /api/agent/pending-ai-prompt-jobs?limit=10`
  - `POST /api/agent/ai-prompt-jobs/:jobId/claim`
  - `POST /api/agent/ai-prompt-jobs/:jobId/complete` — body: `{ ok, improvedText?, error? }`
- Новые MCP-тулы:
  - `pf_list_pending_ai_prompt_jobs`
  - `pf_claim_ai_prompt_job`
  - `pf_complete_ai_prompt_job`
- Расширение `ListMyDispatchedProjects` (и `/me/dispatched-projects`): добавить `pendingAiPromptJobCount` к существующим счётчикам — чтобы Ralph в одном round-trip'е знал, есть ли AI-работа.
- Обновление `docs/ralph-dispatcher-guide.md`: новый блок в главном цикле — после kanban-job'ов проверять и AI-job'ы.

### Что СНАРУЖИ scope (следующие итерации)

| Тема | Куда |
|---|---|
| Streaming прогресса AI в реальном времени | Отдельно — потребует SSE; на v1 хватит long-poll'а |
| История улучшений (undo дальше одного шага) | Отдельно — на v1 кнопка «Откатить» в toast'е возвращает к `lastOriginal` в state |
| AI-улучшение комментариев и KB-документов | Отдельно — тот же протокол, новый `target_kind` |
| Multi-language (улучшение английского текста) | Отдельно — на v1 фиксируем русский |
| Тонкая настройка длины ответа (краткое/подробное) | Отдельно — на v1 один режим «нормальный» |
| Стоимостной учёт и квоты | Отдельно — нужна метрика токенов в `pf_complete_ai_prompt_job` |
| Авто-улучшение по timer'у (без нажатия) | Отдельно — продуктовое решение «AI редактирует пока юзер думает» |
| Несколько одновременных AI-диспетчеров с координацией | Отдельно — на v1 один проект = один диспетчер; `pf_claim_ai_prompt_job` атомарен, так что если несколько Ralph-инстансов одного юзера — claim защищает |

### Не-цель: повторное использование

Эта спека намеренно описывает **протокол**, а не «как ProjectsFlow что-то делает». Сайт + дисперчер — две слабо связанные стороны, общающиеся через БД-очередь и HTTP. Другой проект может реализовать **свою сторону «сайт»** (любой стек: PHP, Go, Rails, Next.js — без разницы), сохранив контракт, и взять того же Ralph-диспетчера. Раздел [§9. Generalization](#9-generalization-другой-проект) описывает что именно нужно сохранить.

---

## 2. UX

### 2.1 Расположение кнопки

В `AddTaskDialog` (главный) — в footer'е, **слева от «Отмена»**, после `RalphModeSelect`:

```
[RalphMode ▼]  [✨ AI]  [Отмена]  [Добавить]
```

В `QuickAddTodo` — справа от инпута, перед кнопкой «Добавить»:

```
[textarea ......................................]  [✨ AI]  [Добавить]
```

В `TaskDrawerComposer` — там же где основная submit-кнопка (по аналогичному паттерну).

Кнопка:
- `variant="outline" size="sm"`
- Иконка `Sparkles` из `lucide-react`
- Подпись: «AI» (короткое, чтобы не растягивать ряд)
- `title="Улучшить текст с помощью AI"`

### 2.2 Состояния

| Состояние | Кнопка | Textarea | Сторонние UI |
|---|---|---|---|
| Idle | Active | Editable | — |
| Disabled (пустой текст) | Disabled, тот же стиль | Editable | — |
| Improving | Disabled, иконка `Loader2 animate-spin` | Read-only (или просто disabled), тонкий placeholder «AI улучшает…» | — |
| Success | Active снова | Заменён `improvedText` | Toast: «Текст улучшен» + кнопка «Откатить» |
| Error (timeout/no dispatcher) | Active | Текст не изменён | Toast: «AI временно недоступен» |
| Error (нет прав / 400) | Active | Текст не изменён | Toast с описанием |

«Откатить» — best-effort: храним `lastOriginal: string \| null` в state компонента, на клик откатываем `setDescription(lastOriginal)` и убираем toast. Не персистим — после закрытия диалога/перезагрузки undo пропадает (это норма для v1).

### 2.3 Что юзер видит «под капотом»

С точки зрения юзера — это синхронная кнопка с задержкой 5–25 сек. Никаких «job pending», «queued», «claimed» — это **детали реализации**. Если задержка превышает 25 сек (Ralph оффлайн, перегружен, баг) — toast «AI временно недоступен». Текст не меняется, юзер продолжает руками.

---

## 3. Жизненный цикл job'а

```
                  POST /api/ai/prompt-jobs
                          │
                          ▼
        ┌─────────────────────────────────┐
        │ ai_prompt_jobs.status = 'queued'│
        └─────────────────────────────────┘
                          │
              GET /api/ai/prompt-jobs/:id?wait=25
                          │
              ┌───────────┴────────────┐
              │                        │
              ▼                        ▼
       (Ralph poll)             (long-poll spin)
              │                        │
              ▼                        │
    pf_list_pending_ai_prompt_jobs     │
              │                        │
              ▼                        │
    pf_claim_ai_prompt_job             │
              │                        │
              ▼                        │
    status = 'running'                 │
              │                        │
              ▼                        │
    [Ralph processes via Claude]       │
              │                        │
              ▼                        │
    pf_complete_ai_prompt_job          │
              │                        │
              ▼                        │
    status = 'succeeded' (+ improvedText)
                          │
                          └────────────┘
                          ▼
                  200 { improvedText }
```

**Состояния:**

| Status | Когда | Откуда переход |
|---|---|---|
| `queued` | Сайт создал job через POST | — |
| `running` | Ralph claim'нул (`UPDATE ... WHERE status='queued'`) | `queued` (атомарно) |
| `succeeded` | Ralph написал результат через `complete` | `running` |
| `failed` | Ralph не смог (Claude API ошибка, парсинг ответа сломан) | `running` |
| `cancelled` | Юзер отменил (закрыл диалог) или server-side cleanup истёкших | `queued` или `running` |

**Long-poll контракт:**

`GET /api/ai/prompt-jobs/:jobId?wait=25` — сервер удерживает соединение до:
- готовности (status ∈ {succeeded, failed, cancelled}) — возвращает 200 с финальным состоянием
- истечения `wait` секунд — возвращает 504 `{ error: 'timeout' }`

Фронт при 504 показывает toast «AI временно недоступен», текст не меняется. Job в БД остаётся как есть (не удаляем — Ralph может ещё подъехать, юзер просто промахнулся). Cleanup истёкших (старше N минут) — отдельный TTL-job, см. §6.

**Идемпотентность:** `GET` можно дёргать сколько угодно раз — он не меняет state, просто читает. Если фронт перезапросил после таймаута и job уже succeeded — получит 200 сразу.

---

## 4. DB schema

```sql
-- db/042_ai_prompt_jobs.sql
-- Очередь AI-промпт-улучшений. Сайт кладёт job, Ralph-диспетчер обрабатывает.
-- См. docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md

CREATE TABLE IF NOT EXISTS ai_prompt_jobs (
  id                CHAR(36)                                                NOT NULL,
  -- Кто заказал улучшение (для permission-проверки на стороне Ralph'а).
  created_by        CHAR(36)                                                NOT NULL,
  -- Проект, чтобы Ralph забрал KB для контекста (NULL = inbox / нет проекта).
  -- Также определяет, какой Ralph будет работать (через dispatcher_user_id проекта).
  project_id        CHAR(36)                                                NULL,
  -- Назначенный диспетчер на момент enqueue. Денормализация:
  -- - для project_id != NULL: project.dispatcher_user_id
  -- - для project_id = NULL (inbox): дефолтный системный диспетчер (см. §5.1)
  -- Ralph при poll'е фильтрует по dispatcher_user_id = caller_user_id.
  dispatcher_user_id CHAR(36)                                               NOT NULL,
  status            ENUM('queued','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'queued',
  -- Исходный текст от юзера (1..5000 char'ов). Validated на API.
  input_text        TEXT                                                    NOT NULL,
  -- Опциональный KB-контекст, пре-собранный сервером. NULL если проекта нет
  -- или у проекта нет KB (kb_kind = 'none'). Лимиты — см. §5.2.
  kb_context        MEDIUMTEXT                                              NULL,
  -- Результат от Ralph'а (улучшенный текст). NULL пока не succeeded.
  improved_text     TEXT                                                    NULL,
  -- Ошибка от Ralph'а если failed. NULL иначе.
  error             VARCHAR(500)                                            NULL,
  claimed_at        TIMESTAMP                                               NULL,
  finished_at       TIMESTAMP                                               NULL,
  created_at        TIMESTAMP                                               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP                                               NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Главный poll-индекс: Ralph фильтрует «где я диспетчер + status queued».
  KEY idx_ai_prompt_jobs_dispatcher_status (dispatcher_user_id, status, created_at),
  -- Cleanup истёкших — по created_at + status.
  KEY idx_ai_prompt_jobs_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Зачем `dispatcher_user_id` денормализован.** Чтобы Ralph при `listPendingForDispatcher(userId)` сделал ровно один индексный лукап без join'а с `projects`. Когда юзер меняет dispatcher'а проекта — старые queued AI-job'ы остаются за старым диспетчером (это OK: они короткоживущие, ≤25 сек long-poll, всё равно протухнут через cleanup).

**Зачем `kb_context` хранится в БД.** Ralph не лазит в KB сам — это даёт три выгоды:
1. Меньше прав на стороне Ralph'а (не нужен read доступ к KB).
2. Атомарность: job самодостаточен, Ralph не зависит от состояния KB в момент обработки.
3. Прозрачность: можно посмотреть в БД, что именно ушло в контекст (debug).

**Кэш.** Прямого кэша на v1 нет — Claude prompt caching берёт своё на стороне Ralph'а через стабильный system-промпт.

---

## 5. Server: application-слой

### 5.1 Inbox-задачи и системный диспетчер

Для задач без проекта (`project_id IS NULL` — Inbox) нужен «дефолтный» диспетчер. Решение: новая env-переменная `AI_PROMPT_DEFAULT_DISPATCHER_EMAIL` (по умолчанию `admin@projectsflow.ru`). При старте сервера резолвим email → userId, кешируем; если юзера нет — лог-warning, AI-кнопка для Inbox-задач возвращает 503 `ai_not_configured`.

Альтернатива (не выбрана): требовать project_id всегда — тогда AI работает только в проектах. Хуже UX, отбрасываем.

### 5.2 KB-context: что брать и как обрезать

`PrepareKbContext` (вспомогательная функция в `application/ai/`):

```ts
async function prepareKbContext(
  projectId: string,
  userId: string,
  deps: { listKbDocuments, getKbDocument },
): Promise<string | null> {
  const project = await deps.projects.getById(projectId);
  if (!project || project.kbKind === 'none') return null;

  const docs = await deps.listKbDocuments.execute(projectId, userId);
  // Берём только первые 12 документов — хватит контекста, не разорвём токен-лимит.
  const top = docs.slice(0, 12);

  const parts: string[] = [];
  let total = 0;
  const MAX_PER_DOC = 4000;       // символов
  const MAX_TOTAL = 30000;        // символов суммарно

  for (const summary of top) {
    if (total >= MAX_TOTAL) break;
    try {
      const doc = await deps.getKbDocument.execute(projectId, userId, summary.path);
      const title = String(doc.frontmatter['title'] ?? summary.path);
      let body = doc.body;
      if (body.length > MAX_PER_DOC) body = body.slice(0, MAX_PER_DOC) + '\n…(truncated)';
      const part = `## ${title} (${summary.path})\n\n${body}`;
      if (total + part.length > MAX_TOTAL) {
        parts.push(part.slice(0, MAX_TOTAL - total) + '\n…(truncated)');
        total = MAX_TOTAL;
      } else {
        parts.push(part);
        total += part.length;
      }
    } catch {
      // Если конкретный документ упал (race, удалили) — просто пропускаем.
    }
  }

  return parts.length === 0 ? null : parts.join('\n\n---\n\n');
}
```

### 5.3 Use-cases

```
server/src/application/ai-prompt/
  AiPromptJobRepository.ts        — port
  EnqueueAiPromptJob.ts           — POST /api/ai/prompt-jobs
  WaitForAiPromptJob.ts           — GET /api/ai/prompt-jobs/:id?wait=N
  ListPendingAiPromptJobs.ts      — GET /api/agent/pending-ai-prompt-jobs
  ClaimAiPromptJob.ts             — POST /api/agent/ai-prompt-jobs/:id/claim
  CompleteAiPromptJob.ts          — POST /api/agent/ai-prompt-jobs/:id/complete
  prepareKbContext.ts             — helper выше
```

#### `EnqueueAiPromptJob.execute(input)`

```
1. Валидация: text ∈ [1..5000] char'ов. projectId — UUID или null.
2. Permission: если projectId != null → requireProjectAccess(projectId, userId, 'read_project').
   Inbox-задачи без projectId — без project-permission'а.
3. Rate-limit: 60 запросов / час / userId. 429 'rate_limited'.
4. Resolve dispatcher:
   - projectId != null: project.dispatcher_user_id. Если null → 503 'no_dispatcher_for_project'.
   - projectId = null: defaultAiDispatcherUserId (из env). Если null → 503 'ai_not_configured'.
5. Pre-fetch KB context (см. §5.2). Best-effort; ошибки → null.
6. Insert ai_prompt_jobs (status='queued').
7. Return { jobId, status: 'queued', createdAt }.
```

#### `WaitForAiPromptJob.execute({ jobId, userId, maxWaitMs })`

```
1. job = repo.findById(jobId). 404 если нет.
2. Permission: job.created_by === userId или userId admin. Иначе 403.
3. Если job.status уже терминальный (succeeded/failed/cancelled) — вернуть сразу.
4. Иначе: long-poll loop:
   - deadline = now + maxWaitMs (default 25000, max 60000).
   - poll каждые 500ms: repo.findById(jobId). Если status терминальный — вернуть.
   - Если deadline истёк — вернуть null (handler → 504 timeout).
```

> **Замечание.** На MariaDB короткий poll-loop приемлем — мы говорим про 50 polls на job, ровно 1 SELECT в каждом. При нагрузке этого хватит. Если станет узким местом — заменим на pub/sub в памяти процесса (нотификация от `CompleteAiPromptJob` будит спящие waiter'ы). Это улучшение, не на v1.

#### `ListPendingAiPromptJobs.execute({ userId, limit })`

```
Возвращает queued job'ы где dispatcher_user_id = userId. Сортировка createdAt asc.
Limit 1..50 (default 10). Поля: { id, projectId, projectName, createdAt }.
projectName resolved через join (или batch lookup) — Ralph не вызывает pf_get_project'ами.
```

#### `ClaimAiPromptJob.execute({ userId, jobId })`

```
1. job = repo.findById(jobId). 404 если нет.
2. Permission: job.dispatcher_user_id === userId. Иначе 403 'not_dispatcher_for_job'.
3. Атомарный claim: UPDATE ai_prompt_jobs SET status='running', claimed_at=NOW()
   WHERE id=? AND status='queued'. Если 0 rows affected — 409 'already_claimed'.
4. Return полный job с input_text + kb_context.
```

#### `CompleteAiPromptJob.execute({ userId, jobId, ok, improvedText, error })`

```
1. job = repo.findById(jobId). 404 если нет.
2. Permission: job.dispatcher_user_id === userId. Иначе 403.
3. Если status !== 'running' → 409 'not_in_running_state'.
4. Валидация: ok=true ⇒ improvedText непустой ≤5000; ok=false ⇒ error непустой ≤500.
5. UPDATE: status='succeeded'|'failed', improved_text=?, error=?, finished_at=NOW().
6. Return void.
```

### 5.4 Расширение `ListMyDispatchedProjects`

Добавить `pendingAiPromptJobCount` к существующему результату — count'ом группированным по project_id (с правильной обработкой project_id=null → Inbox-bucket). Это просто join + COUNT в одном запросе; см. реализацию `agent_jobs` counter'а для образца.

### 5.5 Cleanup истёкших jobs

`ai_prompt_jobs` могут зависнуть в `queued`/`running` если Ralph оффлайн или упал. Чистим в фоне:

- queued старше **5 минут** → status='cancelled', error='dispatcher_not_responding'.
- running старше **5 минут** → status='cancelled', error='dispatcher_stalled'.
- succeeded/failed старше **7 дней** → DELETE (анти-разраст).

Реализация: периодический setInterval на старте сервера (60 секунд). Простая реализация без bull/queue — это housekeeping, не критично.

---

## 6. HTTP API

### 6.1 Site-side (session-cookie auth)

#### POST `/api/ai/prompt-jobs`

Создаёт job. **Тело:**

```json
{
  "text": "починить меню на мобиле",
  "projectId": "uuid-or-null"
}
```

**Validation:**
- `text`: 1..5000 char.
- `projectId`: UUID v4 string или `null`.

**Response 201:**

```json
{
  "jobId": "uuid",
  "status": "queued",
  "createdAt": "2026-05-28T10:00:00.000Z"
}
```

**Errors:** 400 `invalid_body`, 403 `not_project_member`, 429 `rate_limited`, 503 `no_dispatcher_for_project`, 503 `ai_not_configured`.

#### GET `/api/ai/prompt-jobs/:jobId?wait=25`

Long-poll. Параметр `wait` (1..60, default 25) — seconds. Server держит соединение.

**Response 200 (если succeeded):**

```json
{
  "jobId": "uuid",
  "status": "succeeded",
  "improvedText": "Починить мобильное меню...\n\n- проверить Safari\n- закрыть по клику вне...",
  "createdAt": "...",
  "finishedAt": "..."
}
```

**Response 200 (если failed):**

```json
{
  "jobId": "uuid",
  "status": "failed",
  "error": "claude_api_overloaded",
  "createdAt": "...",
  "finishedAt": "..."
}
```

**Response 504 (timeout):**

```json
{ "error": "timeout", "jobId": "uuid", "status": "queued" }
```

Фронт при 504 показывает «AI временно недоступен». Job остаётся в БД, cleanup отменит её через 5 мин.

**Errors:** 404 `job_not_found`, 403 `not_owner`.

### 6.2 Agent-side (Bearer-token auth, под `requireAgentToken`)

#### GET `/api/agent/pending-ai-prompt-jobs?limit=10`

Возвращает queued job'ы где `dispatcher_user_id === req.user.id`.

```json
{
  "jobs": [
    {
      "id": "uuid",
      "projectId": "uuid-or-null",
      "projectName": "Acme лендинг" /* или null для Inbox */,
      "createdAt": "..."
    }
  ]
}
```

#### POST `/api/agent/ai-prompt-jobs/:jobId/claim`

Атомарный claim. Возвращает полный job с `input_text` и `kb_context`:

```json
{
  "job": {
    "id": "uuid",
    "projectId": "uuid-or-null",
    "projectName": "Acme лендинг",
    "inputText": "починить меню на мобиле",
    "kbContext": "## ... (KB бандл)" /* или null */,
    "status": "running",
    "claimedAt": "...",
    "createdAt": "..."
  }
}
```

**Errors:** 404 `job_not_found`, 403 `not_dispatcher_for_job`, 409 `already_claimed`.

#### POST `/api/agent/ai-prompt-jobs/:jobId/complete`

**Body (success):**

```json
{ "ok": true, "improvedText": "Починить мобильное меню...\n- ..." }
```

**Body (failure):**

```json
{ "ok": false, "error": "claude_api_overloaded" }
```

**Response 204.** Errors: 404, 403, 409 `not_in_running_state`, 400 `invalid_body`.

---

## 7. MCP tools

В `@projectsflow/mcp-server`:

#### `pf_list_pending_ai_prompt_jobs(limit?: number = 10)`

Описание: «Список pending AI-prompt-job'ов где я диспетчер. Использовать в /loop вместе с pf_list_pending_agent_jobs.»

Маппит на `GET /api/agent/pending-ai-prompt-jobs?limit=N`.

#### `pf_claim_ai_prompt_job(jobId: string)`

Описание: «Атомарно подхватить AI-job. 409 если уже claim'нута другой машиной — пропустить.»

Возвращает полный job с `inputText` и `kbContext`.

#### `pf_complete_ai_prompt_job(jobId: string, ok: boolean, improvedText?: string, error?: string)`

Описание: «Завершить AI-job. ok=true → improvedText обязателен; ok=false → error обязателен.»

---

## 8. Dispatcher (Ralph) integration

> **Реальность для текущего деплоя.** Основной диспетчер — `dispatch.ps1` в репо
> `C:\www\ralph` (long-running PowerShell-процесс). Он ходит в **REST API**
> `/agent/*` напрямую (НЕ через MCP), spawn'ит `claude -p` для воркеров.
> MCP-tools `pf_list_pending_ai_prompt_jobs` / `pf_claim_ai_prompt_job` /
> `pf_complete_ai_prompt_job` — оставлены как **escape-hatch** для других
> возможных диспетчеров (например, `/loop` в Claude Code), но `dispatch.ps1`
> их не использует. Детали интеграции в dispatch.ps1 — отдельный design doc
> в репо ralph: [2026-05-28-ai-prompt-improvement-integration-design.md](https://github.com/djdes/PFLoopDispatch/blob/main/docs/superpowers/specs/2026-05-28-ai-prompt-improvement-integration-design.md).

### 8.1 dispatch.ps1: новый блок в главном цикле (REST-poll)

В существующий `while ($true)` цикла (около [dispatch.ps1:4455](https://github.com/djdes/PFLoopDispatch/blob/main/dispatch.ps1#L4455))
добавляется блок перед основным task-polling'ом — AI-job'ы приоритет, т.к.
фронт держит long-poll ≤25 сек:

```powershell
while ($true) {
  Load-Settings
  Tick-Clarifications

  # Новое: AI prompt-job'ы перед всем остальным.
  if ($script:AiPromptJobsEnabled) {
    $jobs = Get-PendingAiPromptJobs      # REST GET /agent/pending-ai-prompt-jobs?limit=10
    foreach ($pendingJob in $jobs) {
      $claimed = Claim-AiPromptJob $pendingJob.id   # REST POST .../claim → null on 409
      if ($claimed) {
        Run-AiPromptWorker $claimed                  # claude -p без MCP, без папки проекта
        break                                        # один job за тик
      }
    }
  }

  # ... дальше старая логика: sync, work-hours, budget, parallel/serial task workers
}
```

`Run-AiPromptWorker` (псевдокод):

```
1. promptTemplate = read c:/www/ralph/prompts/ai-prompt-improve.md
2. fullPrompt = promptTemplate
                  .Replace("{{INPUT_TEXT}}", claimed.inputText)
                  .Replace("{{KB_CONTEXT}}", claimed.kbContext ?? "")
3. process = Start-Process claude -ArgumentList @(
              '-p', fullPrompt,
              '--output-format', 'text'
              # БЕЗ --mcp-config, БЕЗ -d / --add-dir — stateless inference
           )
4. Wait-Process с watchdog 30 сек. Timeout → Stop-Process + complete(ok=false, error='timeout').
5. stdout = capture; trim; truncate to 5000 chars.
6. exit==0 && stdout.length>0 → POST .../complete { ok: true, improvedText: stdout }
   else                       → POST .../complete { ok: false, error: 'claude_failed' }
```

**Латентность.** `claude -p` без MCP стартует за ~2-3 сек, inference на короткий
текст ~3-5 сек — итого 5-10 сек, укладывается в 25-секундный фронт-long-poll.
Best-case (диспетчер свежепоспал) — следующий тик через `pollSeconds=60` сек,
поэтому **в худшем случае юзер ловит таймаут**: job ждёт следующего тика, фронт
истекает раньше. Решение для v1 — toast «AI временно недоступен». Для v2 можно
сократить `pollSeconds` для AI-ветки до 10 сек или использовать SSE-нотификацию.

### 8.2 Альтернативный flow через MCP-tools (для `/loop` Claude Code диспетчера)

Если диспетчер реализован как `/loop` slash-команда в Claude Code (не
`dispatch.ps1`), он использует MCP-tools напрямую:

```pseudo
loop:
  ai_jobs = pf_list_pending_ai_prompt_jobs(limit=10)
  for job in ai_jobs:
    claimed = pf_claim_ai_prompt_job(job.id)   # 409 → skip
    if claimed:
      prompt = SYSTEM_PROMPT + user_msg(claimed.inputText, claimed.kbContext)
      improved = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=[{ "type": "text", "text": SYSTEM_PROMPT,
                  "cache_control": {"type": "ephemeral"} }],
        messages=[{ "role": "user", "content": user_msg }],
      ).content[0].text.strip()
      pf_complete_ai_prompt_job(job.id, ok=True, improvedText=improved)
      break

  # ... дальше обычные kanban agent_jobs.
```

Этот flow одинаково корректен — серверная семантика одна и та же
(`/agent/...`-endpoint'ы и MCP-tools вызывают одни и те же use-case'ы).

### 8.3 System-промпт

```
Ты помощник по постановке задач в трекере проектов. Получаешь короткий черновик описания задачи от пользователя и переписываешь его в виде ясной постановки на русском языке.

Правила:
- Сохраняй исходный смысл и намерение автора. Не добавляй то, что противоречит тексту.
- Пиши простым языком, без канцеляризмов и пафоса. Короткие предложения.
- Структурируй: 1-2 предложения сути, затем (если уместно) маркированный список шагов или критериев готовности.
- Домысливай разумные детали: какие шаги логично следуют, что стоит проверить, какие edge-кейсы возможны. Помечай домысленное явно ("предположительно", "стоит уточнить").
- Если дан KB-контекст проекта — учитывай его терминологию, технологии, конвенции. Не цитируй KB дословно, используй как фон.
- НЕ выдумывай конкретных людей, дедлайны, номера задач, ссылки.
- Объём: не больше 800 символов в итоге. Лучше плотно, чем длинно.
- Возвращай только переписанный текст. Без преамбулы "Вот улучшенная версия:", без markdown-заголовков.
```

---

## 9. Generalization (другой проект)

Эта спека описывает протокол, не привязанный к ProjectsFlow. Чтобы реализовать ту же фичу в любом другом проекте:

**Что нужно от стороны «сайт»:**
1. БД-таблица с тем же контрактом полей (можно переименовать). Минимум: `id`, `created_by`, `dispatcher_user_id`, `status`, `input_text`, `kb_context`, `improved_text`, `error`, `created_at`, `finished_at`.
2. POST-эндпоинт, который **создаёт job + пре-собирает kb_context** (если есть концепция KB — иначе оставить NULL).
3. GET-long-poll-эндпоинт на 25 сек с 504 fallback.
4. UI-кнопка по спецификации §2.
5. Если dispatcher — внешний агент с собственным аутом (Bearer-токен) — три endpoint'а под Bearer-auth: `pending`, `claim`, `complete`. Если dispatcher живёт внутри того же приложения как in-process worker — этих endpoint'ов не нужно, claim делается прямо из БД.

**Что нужно от стороны «диспетчер»:**
1. Polling pending-job'ов с фильтром «я диспетчер» каждые N секунд (60 — нормально).
2. Атомарный claim через UPDATE.
3. LLM-вызов с system-промптом из §8.3 (или адаптированным под задачу).
4. Complete с результатом или ошибкой.

**Что варьируется:**
- LLM provider (Anthropic / OpenAI / локальная модель).
- Какой контекст добавлять (KB / база коммитов / база issue'ов).
- Конкретный system-промпт (зависит от цели — улучшение задачи, генерация коммит-сообщения, авто-теги).

**Что одинаково:**
- Состояния (`queued`/`running`/`succeeded`/`failed`/`cancelled`).
- Контракт long-poll (≤25 сек, 504 fallback).
- Принцип «KB pre-fetched сервером» (диспетчер не лазит в KB).

---

## 10. Безопасность и абьюз

- **Rate-limit на enqueue:** 60 запросов / час / userId. Превышение — 429.
- **Permission на проект:** если `projectId != null`, юзер должен быть member с `read_project`.
- **Доступ к результатам:** GET endpoint проверяет `job.created_by === req.user.id`. Owner job'а или admin — иначе 403.
- **Размер input:** жёсткий лимит 5000 chars на API + на frontend (matches `maxLength={5000}` уже на textarea).
- **Размер output:** Ralph должен ограничивать (system-промпт «≤800 символов»); API не парсит, но обрезает improved_text до 5000 char'ов при complete.
- **Утечка KB:** KB-контекст не возвращается в `GET /api/ai/prompt-jobs/:id` — только `improvedText`. Сам контекст хранится в `kb_context` колонке и виден только Ralph'у при claim. Юзер видит только результат.
- **Логирование:** access-log на enqueue/claim/complete (existing access-log infra). НЕ логировать содержимое `input_text` и `improved_text` в app-логи — там может быть приватная информация. Только jobId + outcome.
- **Cancel при закрытии диалога:** опционально (v1 — не делаем; cleanup всё равно отменит через 5 мин). Если делать — `POST /api/ai/prompt-jobs/:id/cancel` ставит status='cancelled' (только если ещё queued).

---

## 11. Тестирование

### Backend unit-тесты

- `EnqueueAiPromptJob`:
  - happy path с проектом и KB → job создан со склееным `kb_context`
  - проект без KB (`kbKind='none'`) → `kb_context = null`
  - `projectId = null` → dispatcher_user_id = defaultAiDispatcherUserId
  - default dispatcher не сконфигурирован → 503 `ai_not_configured`
  - текст 5001 char → 400
  - rate-limit срабатывает на 61-й запрос
- `WaitForAiPromptJob`:
  - status уже succeeded → возвращает сразу без задержки
  - status queued, через 100ms ставим running → succeeded, ловится в poll-loop
  - истечение wait → возвращает null
  - foreign userId → 403
- `ClaimAiPromptJob`:
  - happy path → status='running', claimed_at установлен
  - повторный claim → 409 `already_claimed`
  - чужой диспетчер → 403
- `CompleteAiPromptJob`:
  - ok=true → succeeded + improvedText сохранён
  - ok=false → failed + error
  - повторный complete → 409 `not_in_running_state`
  - чужой диспетчер → 403

### Backend integration-тесты

- POST /api/ai/prompt-jobs → 201 с jobId
- GET .../:id?wait=1 на свежий queued → 504 timeout
- GET .../:id?wait=5 + параллельно из другого теста complete'ом ставим succeeded → 200 с improvedText
- Agent flow: pending → claim → complete (через Bearer-token).
- Cleanup: вставляем job с created_at = 10 мин назад, queued; через minute checker → cancelled.

### Frontend unit-тесты

- `AiImproveButton`:
  - disabled при пустом text
  - клик → вызывает `aiAssistant.improve(text, projectId)`
  - на промис разрешённый — текст заменяется + toast success
  - на промис rejected — toast error + текст не меняется
  - undo через toast.action → `setDescription(lastOriginal)`

### Manual / e2e

- AddTaskDialog: ввести «починить меню», нажать AI, увидеть улучшенный текст в textarea (с реальным Ralph'ом в /loop).
- QuickAddTodo: то же.
- Без Ralph'а: ввести, нажать AI, через 25 сек получить toast «AI временно недоступен».

---

## 12. Открытые вопросы

| Вопрос | Текущее решение | Альтернатива |
|---|---|---|
| Что если у юзера >1 диспетчера (нескольких проектов) — кто берёт Inbox-задачу? | Default dispatcher из env (`admin@projectsflow.ru`) | Брать любого диспетчера из тех, где юзер member — но Ralph'у будет неясно «моя ли эта работа» |
| Должен ли `dispatcher_user_id` пере-резолвиться, когда меняется dispatcher проекта? | Нет, денормализован на момент enqueue | Триггер на UPDATE projects.dispatcher_user_id — но job-ы короткоживущие, не критично |
| Cancel job'а на закрытии диалога | Не делаем (cleanup отменит через 5 мин) | AbortController на фронте + endpoint cancel |
| Чем хитро Ralph отделит AI-job'ы от обычных kanban-job'ов в одном /loop'е? | Отдельный pf_list_pending_ai_prompt_jobs tool | Объединить в pf_list_pending_jobs(kind=...) — теряем читаемость |

---

## 13. Реализация — порядок шагов

1. **DB** — миграция 042.
2. **Domain + ports** — `AiPromptJobRepository`, types.
3. **Use-cases** — Enqueue/Wait/ListPending/Claim/Complete.
4. **Infrastructure** — Drizzle-реализация репозитория, cleanup-job.
5. **Routes** — site-side + agent-side.
6. **DI wiring** — в `server/src/index.ts`.
7. **MCP tools** — три новых.
8. **Расширение** `ListMyDispatchedProjects` и `/me/dispatched-projects` (`pendingAiPromptJobCount`).
9. **Client port + use-case + adapter + DI.**
10. **Client: AiImproveButton + интеграция в AddTaskDialog.**
11. **Client: интеграция в QuickAddTodo и TaskDrawerComposer.**
12. **Tests.**
13. **Docs** — обновить `docs/ralph-dispatcher-guide.md`.

---

**Версия спеки:** v1, 2026-05-28.
