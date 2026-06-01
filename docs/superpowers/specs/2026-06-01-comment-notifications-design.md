# Spec — Уведомления по комментариям: адресная отправка, журнал доставки, deep-link на комментарий

**Дата:** 2026-06-01
**Статус:** утверждён, к реализации
**Связанные слои:** `server/` (notifications, task), `client/` (tasks UI), `db/`

## 1. Проблема и цель

Сейчас при добавлении комментария сервер делает два независимых fire-and-forget вызова —
`notifier.onComment(...)` (email всем участникам) и `fireTgBroadcast(...)` (Telegram) — ни один
из них **ничего не записывает**, а ссылка в письме ведёт на задачу (`/projects/{pid}?task={tid}`),
**без якоря на конкретный комментарий**.

Цель — три связанные фичи поверх единого «плеча» отправки-с-записью:

- **(A)** Письма/TG по комментарию ведут **на сам комментарий** (`#comment-{id}`), при открытии
  задача скроллится к нему и подсвечивает. Плюс «домыслить события»: email при `@mention`,
  и проводка пока-не-подключённых событий `member_changed` и `kb_updated`.
- **(B)** В композере комментария — переключатель **«Уведомить / Никто»** и выпадающий список
  участников (мультивыбор, по умолчанию «Все (N)»). Выбор фильтрует получателей.
- **(C)** У отправленного комментария — меню **⋮** с пунктами: «Кто уведомлён» (по факту, из
  журнала доставки, с каналом email/TG и статусом), «Скопировать ссылку на комментарий»,
  «Скопировать текст».

«Участники» = все члены проекта (`project_members`), отдельной модели watcher'ов нет и не вводим.

## 2. Архитектурное решение (утверждено)

**Подход 1 — один оркестратор.** Новый application-сервис `DispatchCommentNotifications`
владеет: резолвом получателей + фильтром по выбору автора + обоими каналами + записью журнала.
Маршрут вызывает его один раз (по-прежнему fire-and-forget, но с записью). Переиспользует
существующий рендер письма и `SendAgentTelegramNotification` (сохраняем dedup/link/pref-логику TG,
лишь маппим её результат в строку журнала). Единый источник правды «кто/как».

Отвергнуто: «bolt-on» (запись внутри `ProjectNotificationService.onComment` и
`BroadcastTelegramNotificationByTask`) — дублирует фильтр аудитории + якорь + запись в двух местах.

## 3. Модель данных (миграция `db/047_comment_notifications.sql`, append-only)

### 3.1 Новая таблица `comment_notifications` (журнал доставки)

| Колонка | Тип | Примечание |
| --- | --- | --- |
| `id` | CHAR(36) PK | UUID |
| `comment_id` | CHAR(36) NOT NULL | FK → `task_comments.id` ON DELETE CASCADE; индекс |
| `recipient_user_id` | CHAR(36) NOT NULL | FK → `users.id` |
| `channel` | VARCHAR(16) NOT NULL | `email` \| `telegram` |
| `status` | VARCHAR(16) NOT NULL | `sent` \| `skipped` \| `failed` |
| `reason` | VARCHAR(64) NULL | `pref_off`, `not_linked`, `no_email`, `dedup`, `rate_limited`, `forbidden`, код ошибки |
| `created_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | |

UNIQUE `(comment_id, recipient_user_id, channel)`. Индекс по `comment_id`.

### 3.2 Колонка на `task_comments`

`notify_mode` VARCHAR(16) NOT NULL DEFAULT `'all'` — `all` \| `selected` \| `none`.
Нужна, чтобы ⋮-меню отличало «Никто» (0 строк по выбору автора) от «адресовали, но всех
отфильтровали», и подписывало «Все» / «конкретные» без пересчёта членства.

Drizzle-схема (`server/src/infrastructure/db/schema.ts`): добавить таблицу `commentNotifications`
и колонку `notifyMode` в `taskComments`.

## 4. Сервер

### 4.1 Порт + адаптер журнала
- `server/src/application/notifications/CommentNotificationLogRepository.ts` — порт:
  `recordMany(rows): Promise<void>`, `listByComment(commentId): Promise<CommentNotificationRow[]>`.
- `server/src/infrastructure/repositories/DrizzleCommentNotificationLogRepository.ts` — реализация.
  `listByComment` джойнит `users` (displayName, avatarUrl) для UI.

### 4.2 Оркестратор `DispatchCommentNotifications`
`server/src/application/notifications/DispatchCommentNotifications.ts`.
Вход: `{ projectId, comment: {id, taskId, body, actorUserId, actorDisplayName, actorKind, agentName}, audience: {mode: 'all'|'selected'|'none', userIds?: string[]}, forcedEmailUserIds?: string[] }`.
`forcedEmailUserIds` — упомянутые (`@mention`) пользователи: им email шлётся **всегда**
(с якорем), независимо от `audience` и `comment_created`-pref. Единственный писатель в журнал —
этот сервис (никаких параллельных записей из `CreateTaskComment`).
Логика:
1. `members = listByProject(projectId)`, исключить актора.
2. `targeted = mode==='none' ? [] : mode==='selected' ? members ∩ userIds : members`.
   `emailForced = members ∩ forcedEmailUserIds` (объединяется с `targeted` для email-канала).
3. Для каждого получателя (`targeted` ∪ `emailForced`):
   - **email**: если `resolvePref(prefs,'comment_created','team')` и есть `email` → рендер с
     `ctaUrl` c якорем, `EmailSender.send`, запись `email/sent` (или `email/failed` + код).
     Иначе запись `email/skipped` + `pref_off`/`no_email`.
   - **telegram**: вызвать `SendAgentTelegramNotification` (kind `commentOnMyTask`), смаппить
     результат (`ok→sent`, `not_connected/not_started→skipped:not_linked`, `pref_off→skipped:pref_off`,
     `dedup→skipped:dedup`, `forbidden/rate_limited/error→failed:<reason>`).
4. `notifyMode` (= `audience.mode`) сохраняется на комментарии (см. 4.4).
5. `logRepo.recordMany(rows)`.
Best-effort: исключения логируются, не роняют создание комментария.

### 4.3 Якорь в ссылке
`ProjectNotificationService.taskUrl(projectId, taskId, commentId?)` → добавляет
`#comment-${commentId}` если передан. Использовать в письме `comment_created` и в новом
письме `@mention`.

### 4.4 Проводка маршрута и схемы
- `server/src/presentation/tasks/schemas.ts`: `createTaskCommentSchema` получает опц.
  `notify: { mode: 'all'|'selected'|'none', userIds?: string[] }`, дефолт `{mode:'all'}`.
- `CreateTaskComment` / репозиторий: писать `notify_mode` при вставке комментария.
- `server/src/presentation/tasks/routes.ts` (`POST .../comments`, ~561): заменить два
  fire-and-forget на один вызов `deps.dispatchCommentNotifications.execute(...)` с `audience`.
- DI в `server/src/index.ts`: собрать сервис (members repo, email sender, TG sender, log repo).

### 4.5 Read-endpoint «кто уведомлён»
`GET /projects/:pid/tasks/:tid/comments/:cid/notifications` → use-case `GetCommentNotifications`
(проверка доступа: член проекта). Ответ: массив `{ userId, displayName, avatarUrl, channel,
status, reason }`, плюс `notifyMode` комментария. Группировку по получателю делает клиент.

### 4.6 «Домыслить события» (B-scope = широкий)
- **@mention email**: в `CreateTaskComment` для упомянутых пользователей, кроме in-app
  уведомления, слать email с якорем на комментарий (через тот же email-путь, отдельный subject).
  Эти письма тоже пишутся в `comment_notifications` (reason — без, обычный `sent`).
- **member_changed**: в маршрутах добавления/удаления участника вызвать `notifier.onMemberChanged`.
- **kb_updated**: в маршруте записи KB вызвать `notifier.onKbUpdated`.

## 5. Клиент

### 5.1 `NotifyAudienceControl.tsx` (новый, `presentation/components/tasks/`)
Pill-переключатель «Уведомить | Никто» + dropdown (shadcn) со списком «Все (N)» и членов
(аватар + имя) **чекбоксами** (мультивыбор), дефолт «Все». Эмитит `{ mode, userIds }`.
Члены — `projectRepository.listMembers(projectId)`. Без авто-уведомления при `mode==='none'`.

### 5.2 Проводка композеров
- `TaskRepository.createComment(projectId, taskId, body, notify?)` — расширить сигнатуру;
  `HttpTaskRepository` шлёт `notify` в теле POST.
- Встроить `NotifyAudienceControl` в **оба** композера: footer `TaskDrawerComposer.tsx` и
  inline `CommentComposer` внутри `TaskDrawer.tsx`. Состояние выбора → в `createComment`.

### 5.3 Меню ⋮ у комментария + deep-link (C + клиентская часть A)
- `CommentItem` (`TaskDrawer.tsx`, ~1451): `id="comment-{id}"` на `<li>`; добавить kebab
  `DropdownMenu`:
  - **«Скопировать ссылку на комментарий»** → `${origin}/projects/{pid}?task={tid}#comment-{id}`.
  - **«Скопировать текст»** → `body`.
  - **«Кто уведомлён»** → панель: fetch read-endpoint, по каждому получателю строки с
    иконками ✉ email / ✈ telegram и статусом (отправлено / пропущено / ошибка); при
    `notifyMode==='none'` — «Никто не уведомлён».
- Клиентский порт: `taskRepository.listCommentNotifications(projectId, taskId, commentId)` +
  `HttpTaskRepository` + доменный тип `CommentNotification`.
- Deep-link: читать hash `#comment-{id}` при открытии задачи (`KanbanBoard.tsx` / `TaskDrawer`),
  после загрузки комментариев — `scrollIntoView` + кратковременная подсветка (ring-flash).

## 6. Фазы реализации (для плана; каждая отгружаема отдельно)
- **P1** — данные + плечо: миграция, log-repo, `DispatchCommentNotifications`, якорь в `taskUrl`,
  перепроводка маршрута, read-endpoint.
- **P2** — широкие события: email на `@mention`, проводка `member_changed`, `kb_updated`.
- **P3** — композер: `NotifyAudienceControl` в обоих местах + `createComment(notify)` end-to-end.
- **P4** — ⋮-меню (кто-уведомлён / копировать ссылку / копировать текст) + deep-link скролл/подсветка.

## 7. Тестирование
- Unit (server, vitest): резолв аудитории в `DispatchCommentNotifications` (all/selected/none,
  исключение актора), маппинг статусов TG → строки журнала, формат `taskUrl` с якорем.
- Проверки качества: `npm run typecheck`, `npm run lint`, `npm run build` зелёные.

## 8. Нефункциональные требования / границы
- Кириллица во всех пользовательских строках; код/типы — английский (CLAUDE.md §7).
- Миграции append-only (`047_*`), MariaDB-совместимый синтаксис (CLAUDE.md §5).
- Чистая архитектура: новые сущности — domain→application(port+use-case)→infrastructure→presentation;
  `presentation` ходит в инфраструктуру только через DI (CLAUDE.md «Архитектура client/»).
- Отправка best-effort: сбой уведомления не роняет создание комментария.
- YAGNI: отдельной таблицы «намерения» нет (хватает `notify_mode` + журнала); лимит получателей
  и поиск по большому списку участников — вне scope.
