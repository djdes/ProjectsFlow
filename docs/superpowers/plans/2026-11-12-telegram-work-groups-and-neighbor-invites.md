# Рабочие Telegram-группы + «Добавить из соседних» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** рабочие Telegram-группы пространства с автопривязкой по ссылке и подключением новых людей
через бота; кнопка «Из соседних пространств» для пакетных приглашений.

**Architecture:** новые таблицы db/181; порты + Drizzle-репозитории; use-cases
`ManageTelegramWorkGroups`, `TelegramGroupOnboarding`, `ListWorkspaceInviteCandidates`,
`InviteNeighbors`; новые ветки вебхука бота; роуты в `/api/workspaces/:id/...`; клиентские
карточка и диалог. Обычные группы и существующие приглашения ведут себя как раньше.

**Tech Stack:** Node 22, Express 4, drizzle-orm (MariaDB), node:test + tsx; React 19 + shadcn.

**Spec:** `docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md`,
`docs/superpowers/specs/2026-11-12-invite-from-neighbor-workspaces-design.md`

## Global Constraints

- Миграции append-only, MariaDB-синтаксис, `IF NOT EXISTS`; следующий номер — `181`.
- Пользовательские строки — по-русски; код/типы/комментарии-технические — по-английски.
- Слои: domain ← application ← infrastructure ← presentation; presentation клиента — только через `useContainer()`.
- Deep-link payload Telegram ≤ 64 символов `[A-Za-z0-9_-]`: `wg_` + 43 (base64url 32 байта), `wj_` + 12.
- Коды привязки хранятся только как SHA-256; TTL кода — 30 минут, приглашения — 7 дней.
- CSS — логические утилиты, движение только под `motion-safe:`, без `transition-all`.

## Review Focus

- Повтор доставки одного Telegram-update (тот же `sourceKey`) не дублирует текст и не шлёт вторую инструкцию.
- Кнопку «Подключиться»/«Вступить» нажал не автор сообщения — ничего не меняется, подсказка.
- Telegram, уже привязанный к другому аккаунту, при принятии приглашения — вступление проходит, привязка нет, без 500.
- Группа уже рабочая у другого пространства — привязка по коду и вручную отклоняется без раскрытия имени.
- Личный хаб (`kind='default'`): ни рабочих групп, ни приглашений из соседних (ошибка, не 500).

---

### Task 1: Схема и миграция db/181

**Files:**
- Create: `db/181_telegram_work_groups.sql`
- Modify: `server/src/infrastructure/db/schema.ts` (таблицы `workspaceTelegramGroups`, `telegramGroupLinkTokens`, `telegramGroupOnboardings`)

- [ ] Таблицы по спеке: `workspace_telegram_groups(tg_chat_id BIGINT PK, workspace_id FK CASCADE, title, added_by_user_id, created_at)`; `telegram_group_link_tokens(token_hash CHAR(64) PK, workspace_id FK CASCADE, purpose ENUM('work','main'), created_by_user_id, expires_at, created_at)`; `telegram_group_onboardings(id CHAR(12) PK, tg_chat_id, workspace_id FK CASCADE, tg_user_id, sender_name, group_title, pending_text TEXT, last_source_key VARCHAR(128), status ENUM('pending','invited','completed'), invite_id, prompted_at, created_at, expires_at; KEY(tg_chat_id,tg_user_id), KEY(invite_id))`.
- [ ] `npm run typecheck:server` — PASS. Commit.

### Task 2: Репозиторий рабочих групп + учёт в выборе пространства

**Files:**
- Create: `server/src/application/telegram/TelegramWorkGroupRepository.ts`, `server/src/infrastructure/repositories/DrizzleTelegramWorkGroupRepository.ts`
- Modify: `server/src/infrastructure/repositories/DrizzleTelegramChatWorkspaceRepository.ts` (`linkedWorkspaceIds` + рабочие группы)

**Interfaces — Produces:**
```ts
type TelegramWorkGroup = { chatId: number; workspaceId: string; title: string | null; addedByUserId: string | null; createdAt: Date };
interface TelegramWorkGroupRepository {
  listByWorkspace(workspaceId: string): Promise<TelegramWorkGroup[]>;
  findByChat(chatId: number): Promise<TelegramWorkGroup | null>;
  insert(g: Omit<TelegramWorkGroup,'createdAt'>): Promise<'created' | 'exists'>; // PK conflict → 'exists'
  remove(workspaceId: string, chatId: number): Promise<boolean>;
  migrateChat(fromChatId: number, toChatId: number): Promise<void>; // work groups + main digest group
  setMainGroup(workspaceId: string, chatId: number, title: string | null): Promise<void>; // upsert digest settings
  issueLinkCode(i: { tokenHash: string; workspaceId: string; purpose: 'work'|'main'; createdByUserId: string; expiresAt: Date }): Promise<void>;
  consumeLinkCode(tokenHash: string, now: Date): Promise<{ workspaceId: string; purpose: 'work'|'main'; createdByUserId: string } | null>; // delete+return in tx
}
```
- [ ] Реализация Drizzle (consume — транзакция `SELECT … FOR UPDATE` + `DELETE`, истёкшие → null). Typecheck. Commit.

### Task 3: `ManageTelegramWorkGroups`

**Files:** Create `server/src/application/telegram/ManageTelegramWorkGroups.ts` + `.test.ts`; Modify `server/src/application/telegram/TelegramClient.ts` (`getChatMember?(chatId, userId): Promise<{ status: string } | null>`), `server/src/infrastructure/telegram/HttpTelegramClient.ts`; errors в `server/src/domain/telegram/errors.ts`.

**Interfaces — Produces:**
```ts
class ManageTelegramWorkGroups {
  list(workspaceId, actorUserId): Promise<{ groups: TelegramWorkGroup[]; botUsername: string | null }>; // member
  createLink(workspaceId, actorUserId, purpose: 'work'|'main'): Promise<{ url: string; expiresAt: Date }>; // work: lead + team; main: member
  addManual(workspaceId, actorUserId, chatId: number): Promise<TelegramWorkGroup>; // lead+team; getChat → TelegramGroupNotFoundError; getChatMember(actor tg) ∉ member|administrator|creator|restricted → TelegramGroupNotMemberError; actor без Telegram → TelegramNotLinkedError
  remove(workspaceId, actorUserId, chatId): Promise<void>; // lead
  bindFromCode(code: string, chat: { id: number; title: string | null }): Promise<
    { kind: 'bound'|'already'|'main'; workspaceName: string } | { kind: 'taken' } | { kind: 'invalid' }>;
}
```
Errors → 404 `telegram_group_not_found`, 403 `telegram_group_not_member`, 409 `telegram_group_taken`, 409 `telegram_not_linked`, 400 `telegram_bot_unavailable`.

- [ ] Тесты: `createLink` даёт `https://t.me/<bot>?startgroup=wg_<43>` и хеш в репо; viewer → `NotWorkspaceLeadError`; default-хаб → `CannotInviteToDefaultWorkspaceError` для `work`; `bindFromCode` — bound / already (то же пространство) / taken (другое) / invalid (истёк); purpose main → `setMainGroup`; `addManual` — не участник группы → ошибка, успех → insert.
- [ ] Реализация, тесты PASS, commit.

### Task 4: Роуты рабочих групп

**Files:** Modify `server/src/presentation/workspaces/routes.ts`, `schemas.ts`, `server/src/presentation/middleware/errorHandler.ts`, `server/src/index.ts`; Test `server/src/presentation/workspaces/telegramGroups.routes.test.ts`.

- `GET /:id/telegram-groups` → `{ groups: [{ chatId, title, createdAt }], botUsername }`
- `POST /:id/telegram-groups/link` `{ purpose?: 'work'|'main' }` → `{ url, expiresAt }`
- `POST /:id/telegram-groups` `{ chatId: number }` → 201 `{ group }`
- `DELETE /:id/telegram-groups/:chatId` → 204
- [ ] Тест маршрутов с фейками (200/201/204, ошибка → код). Commit.

### Task 5: Вебхук: `/start wg_`, `/id`, приветствие, миграция чата

**Files:** Modify `server/src/application/telegram/HandleTelegramWebhook.ts` (тип message: `new_chat_members`, `migrate_to_chat_id`; deps `workGroups?: ManageTelegramWorkGroups & repo`, `greetingDelayMs?`); Test `HandleTelegramWebhook.workGroups.test.ts`.

- [ ] Тесты: `/start@bot wg_<code>` в группе → `bindFromCode` вызван, ответ «✅ Группа «T» подключена к пространству «W»» (taken/invalid → свои тексты), владельческий `handleGroupStart` НЕ вызван; `/id@bot` в группе → ответ с `<code>-100…</code>`; `/id` в личке → подсказка; `new_chat_members` с ботом → приветствие с id (через `greetingDelayMs: 0`), если группа ещё не рабочая; `migrate_to_chat_id` → `migrateChat(old,new)`.
- [ ] Реализация (ветки ДО гейта упоминания для сервисных сообщений; `wg_` — до `handleGroupStart`). Commit.

### Task 6: Подключение людей (`TelegramGroupOnboarding`)

**Files:** Create `server/src/application/telegram/TelegramGroupOnboardingRepository.ts`, `server/src/application/telegram/TelegramGroupOnboarding.ts` + `.test.ts`, `server/src/infrastructure/repositories/DrizzleTelegramGroupOnboardingRepository.ts`.

**Interfaces — Produces:**
```ts
type GroupOnboarding = { id; tgChatId; workspaceId; tgUserId; senderName; groupTitle; pendingText: string|null; lastSourceKey: string|null; status: 'pending'|'invited'|'completed'; inviteId: string|null; promptedAt: Date|null; expiresAt: Date };
interface TelegramGroupOnboardingRepository {
  findOpen(tgChatId, tgUserId, now): Promise<GroupOnboarding|null>;
  getById(id): Promise<GroupOnboarding|null>;
  findByInvite(inviteId): Promise<GroupOnboarding|null>;
  create(o): Promise<void>; update(id, patch): Promise<void>;
  linkTelegram(userId, tg: { id: number; username: string|null; firstName: string|null }, now): Promise<'connected'|'already_linked'>;
}
class TelegramGroupOnboarding {
  prompt(i: { chatId; groupTitle; workspaceId; workspaceName; tgUserId; tgUsername; senderName; text; sourceKey: string|null; replyToMessageId: number|null; linkedUserId: string|null }): Promise<void>;
  handlePrivateStart(i: { id: string; from: { id; username?; first_name? }; chatId: number }): Promise<void>;
  handleJoinCallback(cq: TelegramCallbackQuery, id: string): Promise<void>;
  completeFromInvite(i: { inviteId; userId }): Promise<{ telegram: 'linked'|'already_linked'|null }>;
}
```
Deps: repo, users, workspaces (`getById`, `getMembership`, `addMember`), invites (`WorkspaceInviteRepository.create`), client, appUrl, botUsername, shortIdGen, randomToken, now, `startTask(tgUserId, chatId, text, ctx)`.

- [ ] Тесты: первый промпт непривязанному → текст из 3 шагов + url-кнопка `t.me/<bot>?start=wj_<id>`; второй в течение 10 мин → «📝 Запомнил», текст дописан; тот же `sourceKey` → без изменений и сообщений; привязанный не участник → callback-кнопка `wj:<id>`; `handlePrivateStart` чужим Telegram → отказ без приглашения; непривязанным → приглашение (role editor, email null) + ссылка `…/invite/<token>`, статус invited; привязанным → addMember editor + `startTask`; `handleJoinCallback` чужой → алерт; свой → addMember + `startTask`; `completeFromInvite` → `linkTelegram`, статус completed, сообщение в личку, `startTask` с запомненным текстом; повторный вызов — no-op.
- [ ] Реализация + Drizzle (linkTelegram — как `DrizzleTelegramPairingRepository.complete`, без токена). Commit.

### Task 7: Гейт рабочей группы в вебхуке

**Files:** Modify `HandleTelegramWebhook.ts` (deps `onboarding?`, `workGroupForChat?(chatId) → { workspaceId, workspaceName } | null`), `TelegramComposerService.ts` (`TelegramGroupContext.workGroup?`); Test `HandleTelegramWebhook.workGroups.test.ts`.

- [ ] Тесты: рабочая группа + непривязанный → `onboarding.prompt` (linkedUserId null), композер не вызван; привязанный не участник → prompt с linkedUserId; участник → композер с `groupCtx.workGroup`; голосовое в рабочей группе без владельца группы → расшифровка и тот же гейт; `/start wj_<id>` в личке → `handlePrivateStart`; callback `wj:<id>` → `handleJoinCallback`; обычная группа — как раньше.
- [ ] Реализация; `index.ts` — сборка репозиториев/use-cases, `startTask` → `telegramComposer.startFromMessage(…, { sourceKey: 'ob:'+id, background: true })`. Commit.

### Task 8: Принятие приглашения → привязка Telegram

**Files:** Modify `server/src/application/workspace/AcceptWorkspaceInvite.ts` (`onAccepted?`), `server/src/presentation/invites/routes.ts` (ответ `{ workspaceId, telegram }`, превью `telegramOnboarding: boolean`), `server/src/application/project/GetInviteByToken.ts`; client `InvitePage.tsx`, `domain/invite/InvitePreview.ts`, invite repo types.

- [ ] Тест `AcceptWorkspaceInvite`: хук вызван с `{ inviteId, userId }`, результат `telegram` проброшен; ошибка хука не валит принятие (лог).
- [ ] Клиент: тост «Вы в пространстве. Telegram привязан — возвращайтесь в группу, задачу я создам» при `telegram === 'linked'`; в превью — строка «Telegram привяжется автоматически». Commit.

### Task 9: Клиент — карточка «Telegram-группы»

**Files:** Create `client/src/domain/workspace/TelegramWorkGroup.ts`, `client/src/presentation/components/workspace/TelegramWorkGroupsCard.tsx`, `client/src/presentation/components/workspace/telegramWorkGroups.ts` (+ `.test.ts`: `parseChatIdInput`); Modify `client/src/application/workspace/WorkspaceRepository.ts`, `client/src/infrastructure/http/HttpWorkspaceRepository.ts`, `client/src/presentation/pages/WorkspaceSettingsPage.tsx`.

- Порт: `listTelegramGroups(id)`, `createTelegramGroupLink(id, purpose)`, `addTelegramGroup(id, chatId)`, `removeTelegramGroup(id, chatId)`.
- Карточка (team-пространства): описание, список групп (название, id, «Отключить» для owner/lead), «Подключить группу» → открыть ссылку + опрос списка каждые 3 с до 5 минут/закрытия, тост при появлении; блок «Не получается?» — `/id` + ручной ввод; «Сделать рабочей» для основной группы сводок, если она не в списке.
- У поля основной группы — кнопка «Подключить автоматически» (purpose `main`), после привязки перечитать настройки сводки.
- [ ] `parseChatIdInput('-100123') === -100123`, `('abc') === null`, `('12') === null` (только отрицательные). Typecheck/lint клиента. Commit.

### Task 10: «Из соседних» — сервер

**Files:** Create `server/src/application/workspace/ListWorkspaceInviteCandidates.ts`, `InviteNeighbors.ts`, `WorkspaceNeighborsRepository.ts` (+ тесты); Modify `DrizzleWorkspaceRepository.ts` (или новый `DrizzleWorkspaceNeighborsRepository.ts`), routes/schemas/index.

**Interfaces — Produces:**
```ts
type InviteCandidate = { userId; displayName; email; avatarUrl; hasTelegram: boolean; workspaces: { id; name; icon }[]; invited: boolean };
interface WorkspaceNeighborsRepository { listCandidates(actorUserId: string, workspaceId: string, now: Date): Promise<InviteCandidate[]>; }
InviteNeighbors.execute({ workspaceId, actorUserId, userIds, role }): Promise<{ results: { userId; status: 'queued'|'reused'|'member'|'not_neighbor'|'error' }[] }>
```
- `GET /:id/invite-candidates`, `POST /:id/invites/neighbors` (zod: `userIds` 1..50 uuid, `role`).
- [ ] Тесты use-cases (viewer → `NotWorkspaceEditorError`; default → `CannotInviteToDefaultWorkspaceError`; не сосед → `not_neighbor`; участник → `member`; повтор → `reused`). Commit.

### Task 11: «Из соседних» — клиент

**Files:** Create `client/src/domain/workspace/InviteCandidate.ts`, `client/src/presentation/components/project/NeighborInviteDialog.tsx`, `client/src/presentation/components/project/neighborCandidates.ts` (+ `.test.ts`: `filterCandidates(list, query)` по имени/почте/названию пространства, регистр не важен); Modify port/HTTP, `WorkspaceInviteForm.tsx`.

- [ ] Тест фильтра; диалог: поиск, галочки (приглашённые — disabled), роль, «Пригласить (N)», тост, `pf:workspace-invites-changed`. Commit.

### Task 12: Проверка и выкладка

- [ ] `npm run typecheck`, `npm run lint`, `npm run test:server`, `npm run test:client`, `npm run build:client && npm run test:smoke` — всё зелёное (вывод в лог).
- [ ] Ревью всей ветки свежим ревьюером; правки.
- [ ] Push, PR в `main` (шаблон PR репозитория), подписка на активность, зелёный `checks.yml` → merge → проверка деплоя «Deploy to projectsflow.ru».
