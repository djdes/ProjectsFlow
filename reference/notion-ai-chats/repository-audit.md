# ProjectsFlow repository audit for durable AI chats

## Current stack

- npm workspaces: `client`, `server`, `landing`, `mcp-server` (`package.json`).
- Client: React 19, TypeScript, Vite 8, React Router 7, Tailwind, Radix UI, Motion, TipTap, React Markdown (`client/package.json`).
- Server: Express 4, TypeScript, Drizzle ORM, MySQL/MariaDB plus scoped SQLite app databases, Zod (`server/package.json`).
- Worker integration: dispatcher/Ralph polls authenticated agent endpoints and completes queued jobs.

Этого стека достаточно для реализации Notion-подобного chat workspace без новой UI-библиотеки.

## What already exists

### 1. Global help assistant shell

- `client/src/presentation/layout/AppShell.tsx:38,331` mounts `HelpWidget` globally.
- `client/src/presentation/components/help/HelpWidget.tsx` owns a floating dialog, Assistant/Support tabs, local message state, clear action, Escape handling and reduced-motion-aware transitions.
- `client/src/presentation/components/help/HelpAssistantPanel.tsx` already has:
  - internal transcript scroll;
  - autos-scroll on new messages;
  - user/assistant bubbles;
  - suggestions;
  - composer with explicit labels;
  - responsive panel sizing.

Но это только local preview. `HelpWidget` прямо фиксирует `ASSISTANT_PREVIEW_REPLY`, хранит messages в component state и сбрасывает их при reload. Saved threads, routes, generated titles, rename, back/forward и worker streaming отсутствуют.

### 2. Existing AI job pipeline

- Domain: `server/src/domain/ai-prompt/AiPromptJob.ts`.
- Web endpoints: `server/src/presentation/ai-prompt/routes.ts`.
- Agent endpoints: `server/src/presentation/agent/apiRoutes.ts:1215-1336`.
- Queue/repository: `server/src/application/ai-prompt/*`, `server/src/infrastructure/repositories/DrizzleAiPromptJobRepository.ts`.
- DB table: `server/src/infrastructure/db/schema.ts:1049-1102`.
- DI/cleanup/default dispatcher: `server/src/index.ts:511,590-623,2315-2333`.

Сильные стороны существующего pipeline:

- authenticated enqueue;
- dispatcher selection;
- queued/running/succeeded/failed/cancelled lifecycle;
- claim/complete;
- ownership checks;
- long-poll result endpoint;
- rate limiting;
- cleanup stale/terminal jobs;
- KB bundle support.

Ограничение: current `AiPromptJobMode` — только `improve | compose | compose-advanced`. Ответ сохраняется одним `improvedText`; модель не хранит conversation turns и не предназначена для durable chat history.

### 3. Project preview AI

- `client/src/presentation/components/project/workspace/ProjectPreview.tsx` mounts `AiPromptSheet`.
- `preview/AiPromptSheet.tsx` и `preview/CodeSheet.tsx` умеют сформировать запрос для выбранного элемента/кода.

Это полезный специализированный client surface, но он не заменяет глобальный AI workspace.

## Gap matrix

| Observed Notion behavior | ProjectsFlow today | Required addition |
|---|---|---|
| Durable saved threads | Local `messages` only | `ai_chat_threads` table/repository/API |
| Durable ordered turns | None | `ai_chat_messages` with monotonic sequence |
| Full-page route | Floating widget only | `/ai` and `/ai/chats/:threadId` routes |
| Time-grouped list | None | Query + Today/7d/30d grouping |
| Generated title | None | worker-generated/first-message title + fallback |
| Inline rename | None | PATCH title with optimistic client update |
| Back/Forward | Not applicable | real router URLs, no modal-only state |
| Running steps/status | Job status exists | event/message model, polling/SSE adapter |
| Rich response/actions | Plain preview string | sanitized markdown + artifact/tool blocks |
| Fixed composer/internal scroll | Exists in small panel | extract/reuse as full-page primitives |
| Optional details panel | Preview has context-specific sheets | thread sources/skills/artifacts side panel |
| Draft persistence | Component state only | local draft per user/thread + new-chat draft |
| Responsive drawer | Help dialog responsive | workspace sidebar drawer at `<768px` |

## Recommended production architecture

### Data model

`ai_chat_threads`

- `id`, `user_id`, nullable `project_id`/`workspace_id`;
- `title`, `status`, `pinned_at`, `last_read_at`;
- `created_at`, `updated_at`, `last_message_at`, optional `deleted_at`;
- index `(user_id, last_message_at desc)` and project/workspace index.

`ai_chat_messages`

- `id`, `thread_id`, `sequence`, `role` (`user|assistant|system|tool`);
- `content_markdown`, `content_json`, `status`;
- `job_id`, `error_code`, timestamps;
- unique `(thread_id, sequence)`.

`ai_chat_artifacts` (or JSON on message for v1)

- type/title/status/project/task/page/file reference and metadata.

### API

- `GET /api/ai/chats?cursor=&limit=`
- `POST /api/ai/chats` (optional; lazy-create on first message is closer to observed behavior)
- `GET /api/ai/chats/:id`
- `PATCH /api/ai/chats/:id` (`title`, `pinned`, `read`)
- `POST /api/ai/chats/:id/messages`
- `GET /api/ai/chats/:id/messages?afterSequence=`
- `GET /api/ai/chats/:id/events` via SSE or a bounded long-poll endpoint for v1

Every query must scope by authenticated user plus workspace/project membership. A thread/job ID alone must never grant access.

### Worker integration

Do not silently map chat to existing `improve` mode: an older dispatcher may treat an unknown mode as legacy improvement. Introduce an explicit chat job contract/endpoints or roll out a new `chat` mode only after the dispatcher rejects unknown modes and advertises capability.

Safe rollout:

1. Schema + repositories + read/list/rename API behind feature flag.
2. Full-page UI with local/demo responses disabled in production.
3. Worker capability handshake (`chat-v1`).
4. Enqueue message job with `threadId`, `messageId`, project/workspace scope and bounded context.
5. Append assistant/tool/artifact events idempotently by `(jobId,eventId)`.
6. Enable chat sending only for capable dispatchers; otherwise show explicit unavailable state.

### Client decomposition

- `AiWorkspacePage`
- `AiThreadSidebar`
- `AiHomeComposer`
- `AiChatPage`
- `AiTranscript`
- `AiMessageBlock`
- `AiComposer`
- `AiThreadActionsMenu`
- `AiThreadRenamePopover`
- `AiDetailsPanel`
- `useAiThreadEvents`

Extract visual primitives from `HelpAssistantPanel`, but do not stretch the existing floating widget into the main feature. Keep `HelpWidget` as support/help entry and route its AI tab to the durable workspace when feature-ready.

## State, caching, and realtime

- Optimistically append the user message with a client idempotency key.
- Immediately create/activate the thread route; generated title may replace a fallback title later.
- Keep `lastMessageAt` so sidebar ordering updates without a reload.
- Poll/SSE must update the same query cache used by list and thread views.
- Pause auto-scroll when the user leaves the bottom; show a labelled jump-to-latest button.
- Persist drafts separately for `new` and each thread; never move/erase a draft accidentally when changing routes.
- Use cursor pagination and transcript virtualization for threads comparable to the observed `107k px` scroll height.

## Security and privacy checklist

- User/workspace/project scope on every thread, message, artifact and worker job.
- Sanitize markdown/HTML and block executable artifact content in the transcript.
- Signed, expiring download URLs for files.
- Do not put credentials/tokens into model context, message content or logs.
- Idempotency for send, claim and completion.
- Per-user/workspace rate limits and max message/context/file sizes.
- Audit rename/pin/delete/share and all tool writes.
- Soft delete plus retention policy; no cross-tenant list/history search.

## Verification plan

1. Repository tests: ownership, membership, ordering, idempotency, rename, unread/pin.
2. API tests: cursor pagination, 401/403/404 distinction, long-poll/SSE reconnect.
3. Worker contract tests: capability negotiation, duplicated events, failed jobs, cancellation.
4. Client tests: optimistic send, generated title replacement, Back/Forward, draft preservation, outside/Escape menu behavior.
5. Playwright: desktop/tablet/mobile scenarios from `scenarios.json`.
6. Accessibility: focus restore, labelled icons, live status, mobile drawer focus trap.
7. Performance: long transcript virtualization and rapid sidebar updates.

## Implementation priority

**P0:** durable threads/messages, real routes, secure API, send/status pipeline, list/open/rename, fixed composer, Back/Forward.

**P1:** running steps, artifacts, right details panel, pin/unread/open-new-tab, generated title, draft persistence, mobile drawer.

**P2:** voice, connectors, skills, personalization, sharing, research/slides/spreadsheet shortcuts.
