# Implementation plan: AI Chats + Project AI Studio

Дата фиксации: 19.07.2026. Статус: план реализации, production-код не изменён.

## 0. Цель, границы и источники поведения

План объединяет три уже исследованные зоны в оригинальную архитектуру ProjectsFlow:

- Notion AI Chats: глобальный раздел ИИ, долговечный список разговоров, deep-link, создание, переименование, архивирование/удаление, восстановление, Back/Forward и responsive-поведение;
- Base44 Project Studio: независимая AI-панель слева, Preview/Dashboard справа, общий верхний toolbar, сохранение чата при переключении режимов и скрытии панели;
- существующие ProjectsFlow Preview Editor, Dashboard, project permissions, agent capabilities, realtime и site-editor jobs.

Источники наблюдаемого поведения: `reference/notion-ai-chats/*`, `reference/base44-preview/*`, `reference/base44-dashboard/*`, `reference/base44-project-studio-v2/*`. Внешний брендинг, приватные API и дефекты доступности не копируются.

Обязательные продуктовые инварианты:

1. Глобальный AI-чат имеет URL `/ai/c/:conversationId`; `/ai` показывает стартовый экран.
2. Studio имеет URL `/projects/:projectId/studio?panel=preview|dashboard&section=overview&path=/&chat=<id>`.
3. Скрытие AI-панели, переход Preview ↔ Dashboard, изменение route/device и Back/Forward не уничтожают conversation или выполняющийся run.
4. AI-ответ сам по себе не меняет файлы. Изменение проекта создаётся как proposal и только после явного подтверждения запускает существующий `project_edit_jobs` pipeline.
5. В v1 личные и project-studio conversations приватны владельцу. Project conversation дополнительно требует действующее членство в проекте на каждом запросе и reconnect.
6. Сервер не передаёт модели credentials, секреты, токены, `.env` и полный app DB dump.
7. Page-level scroll в Studio отсутствует: AI history, Preview canvas/iframe и Dashboard content владеют прокруткой независимо.

## 1. Frontend components

### Новые feature-модули

```text
client/src/domain/ai-chat/
  AiConversation.ts
  AiMessage.ts
  AiRun.ts
client/src/application/ai-chat/
  AiConversationRepository.ts
  aiConversationKeys.ts
client/src/infrastructure/http/
  HttpAiConversationRepository.ts
client/src/presentation/pages/
  AiPage.tsx
  ProjectStudioPage.tsx
client/src/presentation/components/ai/
  AiChatList.tsx
  AiChatListItem.tsx
  AiChatHeader.tsx
  AiConversationView.tsx
  AiMessageList.tsx
  AiMessageItem.tsx
  AiComposer.tsx
  AiEmptyState.tsx
  AiRunStatus.tsx
  AiConversationMenu.tsx
  AiProposalCard.tsx
client/src/presentation/components/project/studio/
  ProjectStudioShell.tsx
  ProjectStudioTopbar.tsx
  ProjectStudioChatPane.tsx
  ProjectStudioWorkspace.tsx
  StudioMobileChatSheet.tsx
client/src/presentation/hooks/
  useAiConversations.ts
  useAiConversation.ts
  useAiConversationStream.ts
  useStudioSplitPane.ts
```

### Точки интеграции

- `routes.tsx`: добавить `/ai`, `/ai/c/:conversationId`, `/projects/:projectId/studio`.
- `Sidebar.tsx`/`SidebarNavRail.tsx`: раздел `ИИ`, grouped conversation list (`Сегодня`, `Прошлая неделя`, `Последние 30 дней`) и `Новый чат`.
- `AppShell.tsx`: для `/ai` и `/projects/:projectId/studio` использовать full-height `overflow-hidden`; дочерние панели сами управляют scroll. В mobile bottom nav добавить `ИИ`.
- `TasksPage.tsx`: оставить задачам доску/таблицу/список/календарь; переход Preview/Dashboard направлять в Studio route. Не продолжать раздувать монолит Studio-состоянием.
- `ProjectPreview.tsx`: добавить controlled-compatible props `embedded`, `initialPath`, `onPathChange`; существующий reducer edit/device/theme/code сохраняется владельцем Preview.
- `ProjectDashboard.tsx`: добавить/закрепить `embedded`, `initialSection`, `onSectionChange`; секции остаются прежними.
- `ProjectWorkspaceSwitcher.tsx`: в project page отображает задачи и ссылки в Studio, в Studio topbar отображает только Preview/Dashboard.

### Геометрия и responsive

- Desktop: topbar 52 px; AI pane default 380 px, min 300 px, max `min(520px, 45vw)`; workspace занимает остаток.
- Splitter keyboard-accessible: `role="separator"`, стрелки ±16 px, Home/End min/max, double click — default.
- Ширина хранится в `localStorage: pf-studio-chat-width`; hook `useResizableWidth` из TaskDrawer не переиспользуется из-за обратного направления и drawer-specific событий.
- Hide/show chat меняет только layout; transition `width/flex-basis 500ms cubic-bezier(0.4,0,0.2,1)`, с `prefers-reduced-motion` без анимации.
- Tablet: pane 340–360 px, workspace получает остаток; optional labels toolbar сворачиваются до иконок раньше горизонтального scroll.
- Mobile: workspace остаётся основным экраном, AI открывается отдельным full-height Sheet. Conversation и run продолжают жить после закрытия sheet.
- Preview device frames: desktop fill, tablet 768×1024, mobile 373×665, центрирование и отдельный canvas scroll.

## 2. State ownership

| State | Владелец | Persistence |
|---|---|---|
| selected conversation | Router (`:conversationId` / `chat`) | URL, Back/Forward |
| Studio panel | query `panel` | URL |
| Dashboard section | query `section` | URL |
| Preview path | query `path` | URL |
| conversation/messages/runs | server + feature repository cache | MariaDB + SSE reconcile |
| list pagination | `useAiConversations` | memory per query key |
| composer draft | `AiComposer` | sessionStorage per conversation, очищается после accepted send |
| attachments before send | `AiComposer` | local memory, uploaded only on send |
| split width | `useStudioSplitPane` | localStorage |
| chat hidden/mobile sheet | `ProjectStudioShell` | sessionStorage per project; не влияет на run |
| Preview edit/device/theme/code selection | существующий Preview reducer | component/session state |
| Dashboard UI filters/editor sheets | существующие dashboard owners | component/query state |
| menus/dialogs/hover | ближайший component | ephemeral |

Не вводить общий mutable store поверх Router и repository. URL — единственный источник route/panel/section/path; сервер — единственный источник persistent conversation state.

## 3. Query/cache keys

Даже при текущих hook-based caches ключи задаются централизованно и не собираются строками в компонентах:

```ts
aiConversationKeys.all
aiConversationKeys.lists()
aiConversationKeys.list({ scope: 'personal' | 'project', projectId?, archived, search? })
aiConversationKeys.detail(conversationId)
aiConversationKeys.messages(conversationId)
aiConversationKeys.run(conversationId, runId)
aiConversationKeys.projectStudio(projectId)
```

- Cursor (`beforeSeq`) является page param, а не частью базового identity списка сообщений.
- SSE event invalidates/patches `detail`, `messages`, `run` и соответствующий `list`.
- Rename/archive/delete не очищают message pages.
- После reconnect с gap выполняется targeted refetch текущей conversation, не глобальный refetch проекта.

## 4. API routes

### Cookie-auth client API

```text
GET    /api/ai/conversations
POST   /api/ai/conversations
GET    /api/ai/conversations/:conversationId
PATCH  /api/ai/conversations/:conversationId
DELETE /api/ai/conversations/:conversationId
POST   /api/ai/conversations/:conversationId/restore
GET    /api/ai/conversations/:conversationId/messages
POST   /api/ai/conversations/:conversationId/messages            multipart/form-data
POST   /api/ai/conversations/:conversationId/runs/:runId/cancel
POST   /api/ai/conversations/:conversationId/runs/:runId/retry
GET    /api/ai/conversations/:conversationId/stream              SSE
GET    /api/projects/:projectId/studio/conversations
POST   /api/projects/:projectId/studio/conversations
POST   /api/ai/conversations/:conversationId/proposals/:id/approve
POST   /api/ai/conversations/:conversationId/proposals/:id/reject
```

Query params: `scope`, `projectId`, `archived`, `search`, `before`, `limit`; messages — `beforeSeq`, `afterSeq`, `limit`. Limit max 100, default 50.

### Agent API — отдельная очередь

```text
GET  /api/agent/pending-ai-conversation-runs?limit=...
POST /api/agent/ai-conversation-runs/:runId/claim
POST /api/agent/ai-conversation-runs/:runId/complete
POST /api/agent/ai-conversation-runs/:runId/fail
```

Project run требует project-bound capability. Personal run выдаётся только dispatcher пользователя, которому принадлежит run. Старые `/pending-ai-prompt-jobs` и site-editor endpoints не расширяются новыми modes.

## 5. Request/response schemas

Все payload валидируются schema-first (Zod/существующий валидатор), unknown fields отклоняются для mutation routes.

```ts
type CreateConversationRequest = {
  kind: 'personal' | 'project_studio';
  projectId?: string;
  title?: string;                    // 1..120
};

type SendMessageRequest = {
  body: string;                      // 1..50_000 после trim
  clientRequestId: string;           // UUID, idempotency
  mode?: 'chat' | 'studio_plan';
  expectedConversationVersion?: number;
  attachments?: File[];              // count/type/size allow-list
};

type ConversationDto = {
  id: string;
  kind: 'personal' | 'project_studio';
  projectId: string | null;
  title: string;
  version: number;
  lastMessageSeq: string | null;
  lastMessageAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MessageDto = {
  id: string;
  seq: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  body: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  runId: string | null;
  parentMessageId: string | null;
  attachments: AttachmentDto[];
  error?: { code: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
};

type SendMessageResponse = {
  conversation: ConversationDto;
  userMessage: MessageDto;
  assistantMessage: MessageDto;      // placeholder
  run: { id: string; status: 'queued' };
};
```

Agent claim возвращает immutable redacted context snapshot, `leaseToken`, `leaseExpiresAt`, prompt version и output schema. Complete принимает `leaseToken`, `idempotencyKey`, assistant body, usage/model metadata и optional safe proposal. Raw chain-of-thought не принимается и не сохраняется.

Стандарт ошибки:

```json
{"error":{"code":"CONVERSATION_VERSION_CONFLICT","message":"...","details":{},"requestId":"..."}}
```

## 6. Database tables and schema

ProjectsFlow использует MariaDB/MySQL + Drizzle, поэтому требование референс-инструкции про PostgreSQL адаптируется к реальному стеку; отдельный PostgreSQL не добавляется. Новая append-only migration: `db/132_ai_conversations.sql`.

### `ai_conversations`

- `id CHAR(36) PK`
- `owner_user_id CHAR(36) NOT NULL FK users`
- `workspace_id CHAR(36) NULL`
- `project_id CHAR(36) NULL FK projects`
- `kind ENUM('personal','project_studio') NOT NULL`
- `title VARCHAR(120) NOT NULL`
- `version INT UNSIGNED NOT NULL DEFAULT 1`
- `last_message_seq BIGINT UNSIGNED NULL`
- `last_message_at DATETIME(3) NULL`
- `archived_at`, `deleted_at`, `created_at`, `updated_at DATETIME(3)`
- CHECK-equivalent application invariant: personal has no project; project_studio has project.

### `ai_conversation_messages`

- `id CHAR(36) PK`
- `seq BIGINT UNSIGNED AUTO_INCREMENT UNIQUE` — глобальный монотонный порядок
- `conversation_id CHAR(36) NOT NULL FK`
- `role`, `status`, `body MEDIUMTEXT`
- `parent_message_id`, `client_request_id`, `run_id`, `model`
- `metadata_json JSON NULL` — только allow-listed metadata
- `error_code`, `error_retryable`
- `deleted_at`, `created_at`, `updated_at`
- unique `(conversation_id, client_request_id)` для user send.

### `ai_conversation_runs`

- `id CHAR(36) PK`, `conversation_id`, `project_id`, `dispatcher_user_id`
- `user_message_id`, `assistant_message_id`
- `mode ENUM('chat','studio_plan','studio_edit')`
- `status ENUM('queued','claimed','running','completed','failed','cancelled')`
- `context_version`, `context_snapshot_json JSON` (redacted, bounded)
- `idempotency_key`, `lease_token_hash`, `lease_expires_at`, `claimed_at`
- `project_edit_job_id CHAR(36) NULL`
- `model`, token/cost metadata, safe error fields
- `created_at`, `started_at`, `finished_at`, `updated_at`

### `ai_conversation_attachments`

- metadata only: `id`, `conversation_id`, `message_id`, `storage_key`, `original_name`, `mime_type`, `size_bytes`, `sha256`, `created_at`, `deleted_at`.
- bytes размещаются через существующий `AttachmentStorage`, prefix `ai-conversations/<owner>/<conversation>/...`.

### `ai_conversation_events`

- `event_seq BIGINT UNSIGNED AUTO_INCREMENT PK`
- `conversation_id`, `event_type`, `entity_id`, `payload_json`, `created_at`
- долговечный replay source для SSE; payload не содержит message body, secrets или attachment URL.

### `ai_conversation_audit_events`

- `id BIGINT UNSIGNED AUTO_INCREMENT PK`
- `conversation_id`, `project_id`, `run_id`, `message_id`
- `actor_kind ENUM('user','dispatcher','system')`, `actor_user_id`
- `action`, `metadata_json`, `request_id`, `created_at`
- audit не заменяется realtime event log и не очищается вместе с run queue.

## 7. Indexes

```text
ai_conversations(owner_user_id, archived_at, last_message_at DESC)
ai_conversations(owner_user_id, project_id, kind, archived_at, last_message_at DESC)
ai_conversations(project_id, deleted_at, updated_at)
ai_conversation_messages UNIQUE(seq)
ai_conversation_messages(conversation_id, seq)
ai_conversation_messages UNIQUE(conversation_id, client_request_id)
ai_conversation_messages(run_id)
ai_conversation_runs UNIQUE(conversation_id, idempotency_key)
ai_conversation_runs(dispatcher_user_id, status, created_at)
ai_conversation_runs(project_id, status, created_at)
ai_conversation_runs(conversation_id, created_at)
ai_conversation_attachments(message_id, deleted_at)
ai_conversation_events(conversation_id, event_seq)
ai_conversation_audit_events(conversation_id, created_at)
ai_conversation_audit_events(project_id, created_at)
ai_conversation_audit_events(actor_user_id, created_at)
```

Для MariaDB проверить реальный query plan на list/pagination/pending worker queries. JSON-поля не индексировать в v1. Full-text search не включать в первую миграцию: bounded `LIKE` по title либо отдельная последующая миграция после измерений.

## 8. Permissions and security

- Personal conversation: только `owner_user_id` может list/read/send/rename/archive/delete/stream.
- Project Studio: owner conversation + актуальный project membership для каждой операции. `read_project` нужен для chat/context, `update_project` — для approve mutation proposal.
- Membership проверяется и при каждом SSE reconnect; отзыв доступа закрывает stream и блокирует дальнейшую выдачу attachment URLs.
- Conversation ID никогда не является авторизацией; repository methods получают `actorUserId` и scope.
- Agent claim проверяет dispatcher binding и project capability (`projectId`, run scope, expiry). Capability одного проекта не читает run другого.
- Context builder использует allow-list: project name/description, выбранные безопасные source fragments, schema metadata без row values по умолчанию, текущий preview route и пользовательский prompt.
- Запрещено включать credentials, GitHub/Telegram/API tokens, `.env`, cookies, system prompts, чужие conversations, полный app DB или server filesystem paths.
- Attachments: MIME sniffing, extension allow-list, per-file/per-message quota, antivirus hook, private signed download, Content-Disposition и CSP.
- User body рендерится как escaped markdown без raw HTML; tool payload не интерпретируется как команды клиента.
- Rate limits: per user send, concurrent runs per user/project, daily token budget; 429 содержит `retryAfterMs`.

## 9. Transactions and consistency

### Send message — одна DB transaction

1. Lock/select conversation с permission/version check.
2. Insert user message (или вернуть существующий по `clientRequestId`).
3. Insert pending assistant placeholder.
4. Insert queued run с immutable redacted context version.
5. Update conversation `last_message_*`, `version`.
6. Insert realtime event rows и audit row.
7. Commit; только затем notify in-memory hub.

Attachment bytes загружаются во временный private key до transaction; при commit metadata связывает их с message, при rollback cleanup job удаляет orphan temp objects.

### Claim/complete

- Claim делает `SELECT ... FOR UPDATE`, проверяет queued/expired lease, записывает hash lease и transition.
- Complete lock-ит run и assistant message, проверяет lease/idempotency и допустимый transition, обновляет оба объекта, пишет event/audit, commit, затем broadcast.
- Повторный complete с тем же idempotency возвращает прежний result; с другим payload — 409.
- External site-editor job создаётся отдельной transaction только после approve; conversation хранит ссылку на job. Не держать DB transaction во время model/Git/file/network I/O.

## 10. Optimistic updates

- Client генерирует `clientRequestId`, сразу добавляет optimistic user message и assistant placeholder.
- Ответ POST или SSE reconciles по `clientRequestId`/real IDs, без дубликатов.
- Если HTTP timeout, клиент сначала refetch по conversation и повторяет тот же idempotency key; не создаёт второе сообщение.
- 4xx удаляет только rejected optimistic pair и восстанавливает composer draft/attachments; persistent ранее загруженная история не rollback-ится.
- Rename/archive/delete оптимистичны с snapshot предыдущего list/detail. 409 применяет server copy и показывает non-destructive toast.
- Cancel мгновенно помечает placeholder `cancelling`; окончательное `cancelled` приходит с сервера.
- Approve proposal становится `approving`; site-editor job ID является подтверждением. UI не показывает «применено» до job completion.

## 11. Conflict resolution

- `PATCH conversation` принимает `expectedVersion` или `If-Match`; mismatch → 409 с current entity/version. Клиент предлагает повторить rename на актуальной версии.
- Messages immutable после accepted send в v1. Edit/branch/regenerate — отдельная будущая операция, не silent overwrite.
- Run transitions заданы конечным автоматом; terminal state не возвращается в running. Retry создаёт новый run и новый assistant placeholder, сохраняя исходный failed message.
- Несколько вкладок сходятся через event sequence; локальный event с seq ≤ lastApplied игнорируется.
- Gap в event sequence → suspend optimistic reconciliation, targeted REST resync, затем resume stream.
- Project edit proposal хранит source artifact/version/commit. Если проект изменился до approve, существующий site-editor conflict возвращает 409; пользователь пересоздаёт proposal либо явно подтверждает rebase flow. Автоматический force overwrite запрещён.

## 12. Realtime events

Event types:

```text
conversation.created | conversation.updated | conversation.archived | conversation.restored
message.created | message.updated
run.queued | run.claimed | run.running | run.completed | run.failed | run.cancelled
proposal.created | proposal.approved | proposal.rejected
project-edit.linked | project-edit.updated
```

- SSE endpoint принимает `Last-Event-ID`; response IDs равны `event_seq`.
- Сначала replay из `ai_conversation_events`, затем subscription к `AiConversationEventHub` без race (subscribe before bounded replay + dedupe).
- Heartbeat 20–25 s; reconnect с exponential backoff и jitter; auth errors не ретраятся бесконечно.
- Event payload содержит IDs, status, version, timestamps и safe summary; полный message получается из response/targeted fetch.
- Для conversation list использовать лёгкое событие через существующий `RealtimeHub` либо user-scoped AI list stream. Не подписывать каждый list row на отдельный SSE.
- Event retention минимум 30 дней или до гарантированного snapshot watermark; если requested event старше retention, сервер отправляет `resync-required`.

## 13. Background jobs and Ralph integration

Добавить отдельный контур, не расширяя semantics старого short-prompt worker:

```text
C:/www/ralph/ai-conversation-worker.ps1
C:/www/ralph/prompts/ai-conversation.md
dispatch.ps1: start/stop/health helpers for a dedicated pool
```

- Feature flag `PF_AI_CONVERSATION_WORKER_ENABLED=0` по умолчанию при первом deploy.
- Worker poll → claim lease → heartbeat → model call → schema validate → complete/fail.
- Max concurrency configurable per dispatcher; project/user fairness, bounded retries, exponential backoff, dead-letter terminal failure.
- Cancellation проверяется до model call, во время heartbeat и перед complete; late result cancelled run не публикуется.
- Text conversation worker не получает MCP/filesystem write. Для реального изменения создаётся proposal; approve запускает существующий `site-editor-worker.ps1` с project-scoped capability.
- Старый `ai-job-worker.ps1` продолжает только improve/compose; `site-editor-worker.ps1` — только project edit jobs. Unknown mode никогда не попадает в fallback `Do-Improve`.
- Cleanup: terminal run payload/context можно ограниченно очищать по retention, но conversations/messages/audit не удаляются job cleanup-ом.
- Health/metrics: queue age, claim latency, run duration, cancellations, retry/dead-letter rate, token/cost, SSE lag.

## 14. Audit events

Обязательные действия: conversation create/rename/archive/delete/restore; message accepted; attachment accepted/rejected; run queue/claim/complete/fail/cancel/retry; proposal create/approve/reject; project edit job link/result/publish.

Audit metadata содержит object IDs, actor, project, status transition, model name, token counts, duration, requestId и safe error code. Не содержит prompt/body, generated source, secrets, signed URLs или raw model trace. Project-changing approve/result дополнительно отражается в существующей project activity/version history, чтобы пользователь видел изменение рядом с другими изменениями задачи/проекта.

## 15. Error mapping and UX

| HTTP | Code examples | UX |
|---|---|---|
| 400 | `INVALID_REQUEST` | inline validation, draft сохранён |
| 401 | `AUTH_REQUIRED` | общий auth flow |
| 403 | `PROJECT_ACCESS_DENIED`, `MUTATION_NOT_ALLOWED` | закрыть stream, read-only explanation |
| 404 | `CONVERSATION_NOT_FOUND` | вернуть `/ai`, убрать stale list item |
| 409 | `CONVERSATION_VERSION_CONFLICT`, `RUN_STATE_CONFLICT`, `PROJECT_VERSION_CONFLICT` | resync + explicit retry/recreate |
| 413 | `ATTACHMENT_TOO_LARGE`, `MESSAGE_TOO_LARGE` | показать конкретный лимит |
| 415 | `ATTACHMENT_TYPE_UNSUPPORTED` | удалить только неподдерживаемый файл |
| 422 | `CONTEXT_UNAVAILABLE`, `OUTPUT_SCHEMA_INVALID` | retryable/non-retryable state |
| 429 | `AI_RATE_LIMITED`, `AI_BUDGET_EXCEEDED` | countdown, без duplicate retry |
| 503 | `AI_WORKER_UNAVAILABLE`, `MODEL_UNAVAILABLE` | сохранить queued/draft, предложить retry |

Каждая ошибка логируется с `requestId`; user-facing текст не показывает provider response, stack, SQL или filesystem path.

## 16. Unit tests

- Domain invariants conversation kind/project, title limits, allowed run transitions.
- Permission policy personal/project/revoked membership/update permission.
- Context redactor: secrets/credentials/full DB rows исключаются.
- Idempotency for send, claim, complete, retry.
- Reducer/cache reconcile: optimistic + POST + duplicate/out-of-order SSE + gap.
- Split pane clamp, keyboard resize, persisted invalid value recovery.
- URL parser/serializer for panel/section/path/chat with safe defaults.
- Grouping conversations by date and title generation fallback.
- Attachment validation and orphan cleanup policy.
- Proposal approval requires explicit permission and immutable source version.

## 17. API/integration tests

- CRUD/list/pagination/search/archive/restore for owner.
- Cross-user enumeration/read/send/stream blocked; project member removed mid-session.
- Atomic send creates exactly user + placeholder + run; injected failure leaves none.
- Duplicate `clientRequestId` and complete idempotency return same objects.
- Agent cannot claim other dispatcher/project run; expired lease reclaim works.
- Cancel races with claim/complete; terminal transitions remain valid.
- SSE replay from `Last-Event-ID`, live handoff without loss/duplicate, retention resync.
- Multipart quotas/type sniffing/signed attachment auth.
- Approve proposal creates exactly one existing site-editor job; conflict and failed job reflected.
- Migration up on realistic MariaDB, FK/index verification and rollback-compatible reads under feature flag.

## 18. Playwright end-to-end tests

1. `/ai` empty state → create/send → URL changes → reload preserves history.
2. Rename/archive/restore/delete flows; Back/Forward selects correct conversation.
3. Desktop sidebar collapse/restore does not lose selection or running state.
4. Open project Studio; send prompt; switch Preview ↔ Dashboard; hide/show chat; run continues.
5. Preview route/device/edit/theme/code interactions remain operational inside Studio.
6. Dashboard section navigation, Data horizontal/vertical scroll and row editor remain independent from chat scroll.
7. Resize splitter mouse + keyboard, refresh persistence, reduced motion.
8. Mobile AI page and Studio chat sheet, composer above virtual keyboard viewport.
9. Optimistic send under delayed response; forced reconnect replays without duplicates.
10. Proposal approve → site editor progress/result; project conflict has safe recovery.
11. Permission revoked while open → stream closes and protected content disappears.
12. Accessibility: focus order, Escape menus/sheets, route chooser labels, `aria-pressed`, focus restoration.

Тесты создают собственные fixtures и не используют приватные reference accounts.

## 19. Visual regression tests

Baseline viewports: 1440×900, 1024×768, 390×844. Captures:

- AI home, existing conversation, conversation list collapsed/restored;
- Studio Preview desktop/tablet/mobile device frames;
- Studio chat open/hidden and transition settled states;
- edit element toolbar, route menu, theme/code/proposal states;
- Dashboard overview, Data grid with both scrollbars, row editor sheet, mobile section selector;
- loading/empty/error/cancelled/permission-denied states.

Assertions включают 52 px topbar, independent pane boundaries, no document scrollbar, splitter min/max, composer anchoring, no toolbar horizontal scroll before labels collapse. Маскируются timestamps, avatars, generated text and result iframe dynamic content; не маскируется geometry.

## 20. Migration and rollout strategy

### Phase 1 — schema and dormant backend

1. Добавить `132_ai_conversations.sql`, Drizzle mapping, repository and policy tests.
2. Deploy server routes/event hub behind `AI_CONVERSATIONS_ENABLED=0`.
3. Выполнить migration, проверить indexes/query plans, synthetic transaction/SSE smoke.

### Phase 2 — worker dark launch

4. Deploy Ralph dedicated worker with polling disabled.
5. Включить для internal allow-list, проверить claim/lease/cancel/idempotency/metrics.
6. Не изменять legacy AI prompt and site-editor worker pools.

### Phase 3 — global AI UI

7. Deploy `/ai` routes, Sidebar/mobile nav and conversation UI behind user flag.
8. Постепенно 1% → internal workspace → 10% → 100%, контролируя errors/queue age/SSE reconnect/token spend.

### Phase 4 — Project Studio

9. Deploy shared `ProjectStudioShell`, embedded Preview/Dashboard adapters and project-private chat.
10. Сначала link-only из project workspace, затем основной Preview/Dashboard entry.
11. После стабилизации удалить только старый local workspaceMode glue; не переписывать Preview/Dashboard internals одновременно.

### Phase 5 — mutation proposals

12. Включить proposal UI read-only, затем approve через существующий site-editor pipeline для internal users.
13. После audit/conflict/rollback smoke расширить rollout.

Совместимость: новые таблицы и routes additive; старый клиент продолжает работать. Старые migrations не редактируются. API DTO versioned additively. Никаких destructive backfill в первой версии.

## 21. Rollback plan

- Немедленный operational rollback: выключить `AI_STUDIO_ENABLED`, `AI_CONVERSATIONS_ENABLED`, затем `PF_AI_CONVERSATION_WORKER_ENABLED`; новые routes возвращают controlled 404/503, Tasks/Preview/Dashboard остаются доступны по старому пути.
- Остановить claim новых runs; claimed jobs получают cancel/lease expiry. Не удалять messages/runs во время incident.
- Client rollback безопасен, потому что schema additive и старый client не читает новые таблицы.
- Server rollback безопасен до версии перед feature, если migration `132` остаётся на месте. Физическое удаление таблиц не является частью аварийного rollback.
- Если ошибочна миграция, исправлять новой append-only `133_*`; destructive down выполняется только после export/backup, нулевого feature traffic и отдельного change approval.
- Если проблема только в Studio shell, выключить Studio flag, сохранив `/ai` conversations.
- Если проблема в model/worker, выключить worker: queued messages остаются видимыми и retryable; оператор может массово cancel по безопасной admin-команде.
- Если проблема в proposal/site-editor bridge, выключить только approvals; chat остаётся read-only. Уже созданные `project_edit_jobs` продолжают существующий audited lifecycle или отменяются штатным механизмом.
- Перед каждым rollout сохранять DB backup/schema checksum, Ralph version and feature flag snapshot. Recovery smoke: auth, project board, existing Preview, Dashboard, legacy AI prompts, site editor, new conversation read-only.

## Definition of Done

- Все разделы 1–21 реализованы и покрыты указанными тестами.
- Security review подтверждает owner/project/capability boundaries и redaction.
- No-loss SSE replay и send/complete idempotency проверены fault injection.
- Preview/Dashboard regression suite зелёный во всех трёх viewport.
- Worker queue health, audit trail, feature flags and rollback runbook доступны эксплуатации.
- Production implementation не содержит ссылок на приватные reference APIs/assets и сохраняет визуальный язык ProjectsFlow.
