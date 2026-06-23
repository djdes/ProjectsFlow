# Чат пространства + навигационный glass-rail в сайдбаре

**Дата:** 2026-06-23
**Статус:** Утверждён дизайн, ожидает сверки с кодом и плана реализации
**Тип:** Full-stack фича (БД, сервер, клиент, UI, realtime)
**Зависит от:** [пространства](2026-06-23-workspaces-and-sidebar-redesign-design.md) — ветка `feat/workspaces`
(закоммичена, не слита в `main`). Чат скоупится по активному пространству и его участникам.

## 1. Контекст и цель

В сайдбаре под блоком-переключателем пространства (`WorkspaceSwitcher`) добавляем строку из
четырёх иконок-кнопок: **Главная · Чат · Входящие · Поиск**. Кнопки переиспользуют
«парящую стеклянную» анимацию нижней мобильной навигации (`MobileBottomNav`). Кнопки
**Главная/Чат** переключают нижнее содержимое сайдбара между списком проектов и общим
чатом пространства. **Входящие/Поиск** — это перенесённые из шапки моментальные действия.

Чат — это **один общий канал на всё пространство**, где переписываются все его участники
(`workspace_members`). Референс UX — Telegram: сообщения уезжают вверх при отправке,
реакции, ответы (reply), @упоминания, вложения, редактирование/удаление, «умный» скролл.

Объём v1 (подтверждено при брейншторме): отправка, редактирование, удаление, реакции,
ответы (reply), @упоминания, картинки/файлы, умный скролл. Десктоп-first.

## 2. Ключевые решения

- **Где живёт чат:** прямо в колонке сайдбара (~260px), на месте `SidebarProjectList`.
  Главная/Чат — это переключатель (held-toggle) нижней области сайдбара, НЕ маршрут.
  Состояние вида хранится в `localStorage` (`pf_sidebar_view: 'home' | 'chat'`), переживает
  перезагрузку, дефолт `home`. Десктоп — основной таргет; мобильный чат (drawer/полноэкранно)
  и пункт в нижнем таб-баре — отдельной итерацией (см. §12).
- **Скоуп изоляции:** один чат на одно пространство. Доступ = участник пространства
  (`workspace_members`). Сообщения другого пространства недоступны (гард + фильтр по
  `workspace_id`). Активное пространство — `users.current_workspace_id` (уже есть).
- **Порядок/курсор:** глобально-монотонный `seq BIGINT AUTO_INCREMENT` на таблице сообщений
  (зеркало `seq` из live-сессий) — стабильная сортировка, пагинация (`beforeSeq`/`afterSeq`)
  и replay для SSE без гонок per-workspace счётчика.
- **Realtime:** зеркалим существующий паттерн live-вкладки. Полная лента — через
  workspace-scoped firehose `ChatEventHub` в открытую SSE-вкладку чата. Лёгкое событие
  `workspace_chat_changed` идёт по общему per-user bus (`RealtimeHub`) всем участникам — для
  бейджа 🔴 и счётчика непрочитанного, БЕЗ заливки firehose в общий bus.
- **Удаление — мягкое** (tombstone «Сообщение удалено»), как в TG. Редактирование — без
  лимита по времени, только автором. Удалять может автор ИЛИ owner пространства (модерация).
- **Вложения** переиспользуют порт `AttachmentStorage` (FS сейчас, S3 потом) — как у задач.

## 3. Часть A. Навигационный glass-rail (только фронт)

### 3.1 Поведение

Строка из 4 иконок под `WorkspaceSwitcher` (в полном и в свёрнутом сайдбаре):

| Кнопка | Иконка (lucide) | Тип | Действие |
| --- | --- | --- | --- |
| Главная | `House` | held-toggle | `view='home'` → показать `SidebarProjectList` |
| Чат | `MessageCircle` | held-toggle | `view='chat'` → показать `WorkspaceChatPanel`; бейдж 🔴 при непрочитанном |
| Входящие | `Inbox` | момент. действие | `navigate('/')` |
| Поиск | `Search` | момент. действие | `openSearch()` (модалка глобального поиска) |

- **Стеклянный индикатор** (`layoutId`, spring) стоит под активной из пары Главная/Чат.
  Входящие/Поиск — моментальные: дают «поп» иконки при нажатии, но НЕ удерживают индикатор
  (после действия он остаётся под текущим held-видом).
- Из **шапки сайдбара убираются** кнопки Поиск (🔍) и Входящие — они переезжают в rail.
  В шапке остаются: `WorkspaceSwitcher`, колокольчик 🔔 (с бейджем), тоггл сворачивания.
- Кнопка «Добавить задачу» остаётся над областью переключения (видна в обоих видах).
- В **свёрнутом сайдбаре** (icon-rail, 56px) rail рендерится вертикально теми же иконками;
  Чат при `view='chat'` подсвечен, при клике на десктопе в свёрнутом режиме — разворачивает
  сайдбар и открывает чат (либо просто переключает вид — уточнить при реализации).

### 3.2 Переиспользование анимации (рефактор-вынос)

Сейчас стеклянный индикатор + «поп» иконок зашиты внутри `MobileBottomNav` в
[AppShell.tsx](../../../client/src/presentation/layout/AppShell.tsx). Выносим переиспользуемый
презентационный примитив:

- **`presentation/components/nav/GlassTabBar.tsx`** — рендерит набор айтемов, стеклянный
  индикатор (`layoutId`, пер-инстанс уникальный, чтобы индикаторы двух баров не «прыгали»
  друг к другу), «поп» иконок при срабатывании. Пропсы: `items`, `activeIndex` (`-1` = ничего
  не удержано), `onSelect(index)`, опц. `orientation`/`enableDragSelect`. Анимации под
  `useMotion()` (+ `prefers-reduced-motion`), как сейчас.
- `MobileBottomNav` переписывается поверх `GlassTabBar` (drag-жест остаётся — через
  `enableDragSelect`). Сайдбар-rail — второй потребитель (`activeIndex` = home/chat, без drag).
- Идентичный визуал и пружины — переиспользуем `glassTransition` (spring 520/34/0.7) и
  «поп» (spring 620/15/0.7).

### 3.3 Точка монтирования

`WorkspaceChatPanel` и `SidebarProjectList` оборачиваются переключателем вида внутри
[Sidebar.tsx](../../../client/src/presentation/layout/Sidebar.tsx) (область
`grid-rows-[…1fr…]`). Crossfade/slide между видами под `useMotion()`. **Это единственный
файл с реальным пересечением правок** с сессией пространств — правки держим минимальными
и локализованными (см. §10).

## 4. Часть B. Модель данных (`db/075_workspace_chat.sql`)

> **Прим. о нумерации:** `db/074` занят параллельной веткой `feat/recent-tasks`
> (`074_recent_task_views.sql`), поэтому чат использует `db/075`.

Append-only миграция, MariaDB-совместимый синтаксис. Все id — `CHAR(36)` (UUID, генерит
приложение). FK ставим на уже существующие `workspaces`/`users` (из `db/073`).

```sql
CREATE TABLE IF NOT EXISTS workspace_chat_messages (
  id             CHAR(36)  NOT NULL,
  seq            BIGINT    NOT NULL AUTO_INCREMENT,   -- глобальный монотонный курсор
  workspace_id   CHAR(36)  NOT NULL,
  author_user_id CHAR(36)  NOT NULL,
  body           TEXT      NOT NULL,                  -- '' допустимо если есть вложения
  reply_to_id    CHAR(36)      NULL,                  -- ответ на сообщение (self-ref)
  created_at     DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at      DATETIME      NULL,
  deleted_at     DATETIME      NULL,                  -- мягкое удаление (tombstone)
  PRIMARY KEY (id),
  UNIQUE KEY uq_wcm_seq (seq),                        -- AUTO_INCREMENT требует индекс
  KEY idx_wcm_ws_seq (workspace_id, seq),             -- лента/пагинация по пространству
  CONSTRAINT fk_wcm_ws     FOREIGN KEY (workspace_id)  REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wcm_author FOREIGN KEY (author_user_id) REFERENCES users(id),
  CONSTRAINT fk_wcm_reply  FOREIGN KEY (reply_to_id)   REFERENCES workspace_chat_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_chat_reactions (
  message_id CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  emoji      VARCHAR(16) NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id, emoji),
  KEY idx_wcr_message (message_id),
  CONSTRAINT fk_wcr_message FOREIGN KEY (message_id) REFERENCES workspace_chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_wcr_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_chat_reads (
  workspace_id  CHAR(36) NOT NULL,
  user_id       CHAR(36) NOT NULL,
  last_read_seq BIGINT   NOT NULL DEFAULT 0,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT fk_wcrd_ws   FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wcrd_user FOREIGN KEY (user_id)      REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_chat_attachments (
  id          CHAR(36)     NOT NULL,
  message_id  CHAR(36)     NOT NULL,
  storage_key VARCHAR(255) NOT NULL,                  -- ключ в AttachmentStorage (FS/S3)
  file_name   VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(127) NOT NULL,
  size_bytes  BIGINT       NOT NULL,
  width       INT              NULL,                  -- для картинок (превью)
  height      INT              NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wca_message (message_id),
  CONSTRAINT fk_wca_message FOREIGN KEY (message_id) REFERENCES workspace_chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Drizzle-схему добавляем в `server/src/infrastructure/db/schema.ts` (DECIMAL/BIGINT → `Number()`
при чтении, `parseJsonCol` не нужен — JSON-колонок нет).

## 5. Сервер (Clean Architecture)

Зеркалит структуру `live`/`workspace`.

- **domain/chat/**
  - `ChatMessage.ts` — `{ id, seq, workspaceId, authorUserId, body, replyToId, createdAt, editedAt, deletedAt }`.
  - `ChatReaction.ts` — `{ messageId, userId, emoji }`.
  - `ChatAttachment.ts` — `{ id, messageId, storageKey, fileName, mimeType, sizeBytes, width, height }`.
  - `errors.ts` — `ChatMessageNotFoundError`, `NotMessageAuthorError`, `MessageDeletedError`,
    `EmptyMessageError`, `AttachmentTooLargeError` (лимит как у задач).
- **application/chat/**
  - `ChatRepository.ts` (порт): `listMessages(workspaceId, {beforeSeq?, afterSeq?, limit})`,
    `getById`, `insert`, `updateBody`, `softDelete`, `addReaction`, `removeReaction`,
    `listReactions(messageIds[])`, `listAttachments(messageIds[])`, `insertAttachment`,
    `getLastReadSeq(workspaceId, userId)`, `setLastReadSeq`, `countUnread(workspaceId, userId)`,
    `maxSeq(workspaceId)`.
  - `ChatService.ts` + use-cases: `listMessages`, `sendMessage`, `editMessage`,
    `deleteMessage`, `toggleReaction`, `markRead`, `getUnreadCount`. Все принимают `userId` и
    зовут `requireWorkspaceMember` (для delete — `requireMessageAuthorOrWorkspaceOwner`).
    `sendMessage` после вставки: публикует событие в `ChatEventHub`, лёгкое
    `workspace_chat_changed` через broadcaster, и (если есть @mention) диспатчит уведомления.
- **infrastructure/repositories/DrizzleChatRepository.ts** — реализация порта.
- **infrastructure/realtime/ChatEventHub.ts** — workspace-scoped firehose, зеркало
  `LiveEventHub` (keyed by `workspaceId`; `subscribe`/`publish`; один сломанный коннект не
  роняет рассылку).
- **application/realtime/WorkspaceEventBroadcaster.ts** — резолвит участников через
  `workspaceRepo.listMembers(workspaceId)` и публикует лёгкое `workspace_chat_changed` каждому
  в per-user `RealtimePublisher` (зеркало `ProjectEventBroadcaster`, но по участникам
  пространства). Best-effort.
- **application/chat/DispatchChatMentionNotifications.ts** — по образцу
  `DispatchCommentNotifications`: `parseMentions(body, members, actorUserId)`
  (переиспользуем `application/task/parseMentions.ts`), на упомянутых создаёт in-app
  Notification (`db/012`) + опц. Telegram. Email для чата — НЕ шлём (чат — лёгкий канал;
  можно включить позже). Best-effort, исключения глотаются.
- **presentation/chat/routes.ts** под `/api/workspaces/:workspaceId/chat` (cookie-auth
  `requireAuth`, внутри сервиса — `requireWorkspaceMember`):
  - `GET  /messages?beforeSeq=&afterSeq=&limit=` — страница истории (DESC по seq; гидрируем
    реакции/вложения/reply-превью батч-запросами по id, без N+1).
  - `POST /messages` `{ body, replyToId?, attachmentIds?, clientNonce }` → созданное сообщение.
  - `PATCH  /messages/:id` `{ body }` (author-only).
  - `DELETE /messages/:id` (author или owner пространства) → tombstone.
  - `POST   /messages/:id/reactions` `{ emoji }`, `DELETE /messages/:id/reactions/:emoji`.
  - `POST /read` `{ lastReadSeq }`; `GET /unread` → `{ count }`.
  - `POST /attachments` (multipart) → `{ id }` (заливка в `AttachmentStorage`; привязка к
    сообщению при `POST /messages`); `GET /attachments/:id` — бинарь (гард: участник
    пространства владельца вложения).
  - `GET /stream` — SSE: гард доступа ДО `writeHead`; `res.writeHead(200, {Content-Type:
    text/event-stream, Cache-Control: no-cache,no-transform, Connection: keep-alive,
    X-Accel-Buffering: no})`; `retry: 5000`; replay из БД (`seq > afterSeq`, пагинированно)
    → subscribe `ChatEventHub(workspaceId)`; буферизация событий на время replay; heartbeat
    `: ping` каждые 25с; `event: chat` (kind: `message_added`|`message_edited`|
    `message_deleted`|`reaction_changed`); cleanup на `req.on('close')`. Точная копия
    логики [live/routes.ts](../../../server/src/presentation/live/routes.ts).
- **Wiring** в `server/src/index.ts` (`chatEventHub`, `chatService`, broadcaster), **mount** в
  `server/src/presentation/http.ts` (additive — рядом с workspaces/live).
- **RealtimeEvent**: в `server/src/domain/realtime/RealtimeEvent.ts` добавить в union
  `{ readonly kind: 'workspace_chat_changed'; readonly workspaceId: string }` (additive).

## 6. Клиент (Clean Architecture)

- **domain/chat/** — типы `ChatMessage`, `ChatReaction` (агрегат: `emoji`, `count`,
  `reactedByMe`, `userIds`), `ChatAttachment`, `ChatMessageGroup` (для группировки подряд
  идущих сообщений одного автора).
- **application/chat/**
  - `ChatRepository.ts` (порт).
  - use-cases: `ListChatMessages`, `SendChatMessage`, `EditChatMessage`, `DeleteChatMessage`,
    `ToggleChatReaction`, `MarkChatRead`, `GetChatUnreadCount`.
- **infrastructure/http/HttpChatRepository.ts** — реальная реализация (через `httpClient`).
- **infrastructure/mock/MockChatRepository.ts** — мок по правилам репо (демо-сообщения для dev
  без бэка). _Прим.: текущий DI-контейнер прод-режима проводит HTTP-адаптеры; мок —
  для локальной разработки/тестов use-case'ов._
- Регистрация в `infrastructure/di/container.tsx` (additive: `chatRepository`, use-cases).
- **presentation/hooks/**
  - `useChatMessages(workspaceId)` — начальная страница + бесконечная подгрузка вверх
    (`beforeSeq`) + live-merge из SSE (`EventSource` на `/stream?afterSeq=`, идемпотентно по
    `seq`; зеркало хука live-вкладки). Дедуп собственных сообщений по `clientNonce`.
  - `useSendChatMessage`, `useEditChatMessage`, `useDeleteChatMessage`, `useToggleReaction`
    (оптимистичные апдейты).
  - `useChatUnread(workspaceId)` — счётчик; слушает `workspace_chat_changed` на общем
    realtime-bus (как другие хуки), инкремент/рефетч → бейдж 🔴 на кнопке «Чат».
  - При смене активного пространства (`useCurrentWorkspace`/switch) — инвалидация/рефетч
    чата под новый `workspace_id` (как `useProjects` инвалидируется в спеке пространств).
  - `presentation` ходит только через `useContainer()`.
- **presentation/chat/** (компоненты):
  - `WorkspaceChatPanel.tsx` — колонка чата: лёгкая шапка (название/иконка пространства +
    счётчик участников), `ChatMessageList`, `ChatComposer`. Пустое состояние.
  - `ChatMessageList.tsx` — оконный рендер + «умный» скролл (см. §7), сохранение
    scroll-anchor при подгрузке вверх, авто-прилипание к низу, пилюля «↓ N новых».
  - `ChatBubble.tsx` — пузырь: аватар+имя (группировка подряд), тело с подсветкой
    @mention и ссылок, reply-цитата (клик → скролл+подсветка цели), вложения (превью +
    лайтбокс, переиспользуем `AttachmentLightbox`), строка реакций, метка «изм.», время.
    Hover/long-press → меню действий (Ответить / Редактировать / Удалить / Реакция).
    Tombstone для удалённых.
  - `ChatComposer.tsx` — авто-растущий `textarea`; Enter — отправить, Shift+Enter — перенос;
    кнопка вложения; контекст-бар reply/edit над полем; @-автокомплит (popup по
    `workspaceRepo.listMembers`).
  - `ChatReactionPicker.tsx` — быстрый набор эмодзи (фикс. список ~6 + «ещё»).

## 7. «Умный» скролл (требование пользователя)

Проблема, которую решаем: при тысячах сообщений нативный скроллбар становится крошечным.
Решение — как в TG: рендерим/держим **ограниченное окно** загруженных сообщений, а скроллбар
отражает это окно, а не всю историю.

- Начально грузим `INITIAL_WINDOW` (≈40) последних сообщений; скролл внизу.
- При приближении к верху подгружаем страницу старых (`beforeSeq`, ≈30) и **сохраняем якорь**:
  замеряем `scrollHeight` до/после вставки и компенсируем `scrollTop` (без рывка вида).
- Скроллбар — всегда видимый, через существующий класс `pf-scroll-visible`
  ([globals.css](../../../client/src/styles/globals.css)). Размер бегунка остаётся вменяемым,
  т.к. контейнер скроллит загруженное окно, а не всю историю.
- Новое сообщение: если пользователь у низа — авто-скролл вниз (лента «уезжает вверх», как в
  мессенджере); если проскроллен вверх — не дёргаем, показываем пилюлю «↓ N новых».
- При желании — отпускать дальний верх окна при долгом скролле вниз (cap окна), чтобы DOM не
  рос бесконечно. В v1 достаточно cap по числу узлов; виртуализацию (react-virtual) не тянем,
  если профайл покажет, что окна хватает.

## 8. Анимации (требование «побольше», под `useMotion` + `prefers-reduced-motion`)

- **Glass-rail:** стеклянный индикатор (spring) + «поп» иконок (переиспользование §3.2).
- **Смена вида home↔chat:** crossfade + лёгкий slide области сайдбара.
- **Новое сообщение:** enter fade + slide-up + лёгкий scale; соседние уезжают вверх плавно.
- **Реакция:** spring-pop бейджа реакции; бамп счётчика при инкременте.
- **Reply-переход:** клик по цитате — плавный скролл к цели + краткая подсветка пузыря.
- **Composer:** морф кнопки отправки (disabled→active), slide-in превью вложения, плавное
  появление reply/edit-контекста.
- **Редактирование:** инлайн-морф пузыря в поле редактирования.
- **Бейдж 🔴 на «Чат»:** мягкое появление/пульс при новом непрочитанном.

## 9. Граничные случаи

- Пустой чат — дружелюбное пустое состояние.
- Удалённое сообщение — tombstone, реакции/вложения скрыты, ответы на него остаются (цитата
  «сообщение удалено»).
- Оптимистичная отправка — мгновенный пузырь (`clientNonce`), замена на серверный по `seq`;
  SSE-эхо своего сообщения дедупится по `clientNonce`.
- Доступ — только участник пространства; SSE гейт ДО `writeHead`; иначе 404 (не разглашаем
  чужое пространство, как делают workspace-гарды).
- Смена/удаление активного пространства — чат рефетчится под новый `workspace_id`; открытый
  SSE переоткрывается.
- `prefers-reduced-motion`/`useMotion` off — без движения.
- Лимит размера вложения — как у задач; ошибка `AttachmentTooLargeError`.

## 10. Координация с параллельными ветками (важно: «без конфликтов»)

Чат — на ~95% **новые файлы** (нет пересечений). Реальные точки соприкосновения:

| Файл | Правка чата | Риск | Митигация |
| --- | --- | --- | --- |
| `client/.../layout/Sidebar.tsx` | rail + обёртка переключения вида | **высокий** (его правит сессия пространств) | минимальная локальная вставка; делаем в самом конце, после заморозки файла |
| `client/.../layout/AppShell.tsx` | `MobileBottomNav` → на `GlassTabBar` | средний | вынос в новый файл; в AppShell — только замена внутренностей `MobileBottomNav` |
| `client/.../infrastructure/di/container.tsx` | регистрация chat-репо/use-cases | низкий (additive) | добавляем в конец |
| `server/.../presentation/http.ts`, `server/.../index.ts` | mount + wiring чата | низкий (additive) | рядом с workspaces/live |
| `server/.../domain/realtime/RealtimeEvent.ts` | `+ workspace_chat_changed` | низкий (additive) | новая ветка union |
| `db/075_workspace_chat.sql` | новый файл | нет | — |

Старт — в **отдельном git worktree, ответвлённом от `feat/workspaces`** (чтобы иметь весь
workspace-фундамент: гварды, `listMembers`, `useCurrentWorkspace`, `WorkspaceSwitcher`,
`db/073`). Слияние всех веток — в конце, вместе. Если **вторая незаконченная задача** (в
отдельном дереве) тоже правит `Sidebar.tsx`/`container.tsx`/`http.ts` — это добавит точку
слияния; учесть при финальном merge.

## 11. Реальные интеграционные точки (сверено с кодом ветки `feat/workspaces`)

- Гварды: `requireWorkspaceMember(repo, workspaceId, userId)` / `requireWorkspaceOwner(...)`
  в `server/src/application/workspace/workspaceAccess.ts` (возвращают `WorkspaceMember`).
- `WorkspaceRepository.listMembers(workspaceId): Promise<WorkspaceMember[]>` (обогащён
  displayName/email/avatarUrl) — для @mention и рассылки; `getMembership`,
  `getCurrentWorkspaceId`, `findAnotherForUser` — уже есть.
- Клиент: `WorkspacesProvider`, `useCurrentWorkspace`, `useWorkspaces`, `useSwitchWorkspace`,
  `WorkspaceSwitcher` (смонтирован в шапке сайдбара, compact+full) — уже есть.
- Realtime-паттерн: `RealtimeHub` (per-user bus), `LiveEventHub` (firehose), `RealtimePublisher`,
  `ProjectEventBroadcaster`, SSE-роут live — образцы для зеркалирования.
- Вложения: порт `AttachmentStorage` (`put`/`read`/`delete` по `storageKey`),
  `FileSystemAttachmentStorage`, `attachmentBinaryRoutes` — образец бинарной отдачи.
- Упоминания/уведомления: `application/task/parseMentions.ts`, `DispatchCommentNotifications`,
  in-app Notification (`db/012`).
- Анимации: `useMotion()` → `{ animations }`; стеклянная навигация в `MobileBottomNav`
  (`AppShell.tsx`); класс `pf-scroll-visible` для всегда-видимого скролла.

> Перед реализацией — повторная сверка с кодом (часть файлов в `feat/workspaces` ещё в WIP:
> `useWorkspaceMembers`, страница настроек пространства). Если клиентский `useWorkspaceMembers`
> к тому моменту закоммичен — переиспользуем его в @-автокомплите; иначе добавим свой
> use-case `ListWorkspaceMembers` на клиенте.

## 12. Вне scope v1 (следующие итерации)

- Мобильный чат (полноэкранно вместо drawer; пункт «Чат» в нижнем таб-баре).
- Read-receipts/«прочитано», индикатор «печатает…», закреплённые сообщения, поиск внутри чата.
- Треды/ответы-ветками (у нас плоский reply-quote, как в базовом TG-чате).
- Пересылка (forward), голосовые, превью ссылок (unfurl), email-канал для @mention.
- Виртуализация списка (если оконного рендера §7 окажется недостаточно по перфу).
- Пер-проектные чаты (сейчас — один общий канал на пространство).

## 13. Тестирование

- **Сервер:** unit `ChatService` (send/edit/delete гарды — author/owner, toggle reaction,
  markRead/unread, пагинация beforeSeq/afterSeq, мягкое удаление, mention-dispatch); тесты
  роутов (auth + membership-изоляция: участник чужого пространства не читает чат и ловит 404;
  SSE replay по afterSeq); тест broadcaster (фанаут по `listMembers`).
- **Миграция:** smoke — таблицы создаются, FK/каскады, AUTO_INCREMENT seq монотонен.
- **Клиент:** use-cases на моках; поведение умного скролла (anchor при prepend, прилипание к
  низу, пилюля «новых»); оптимистичная отправка + дедуп по `clientNonce`; тоггл вида rail и
  персист `pf_sidebar_view`; бейдж непрочитанного по realtime-событию.

## 14. Порядок реализации (для плана)

1. Миграция `db/075` + Drizzle-схема.
2. Сервер: domain → application (порт + service + use-cases + mention-dispatch) →
   infrastructure (Drizzle-репо, `ChatEventHub`, `WorkspaceEventBroadcaster`) → presentation
   (routes + SSE) → wiring/mount. `RealtimeEvent += workspace_chat_changed`.
3. Клиент data-слой: domain → application → infrastructure (http + mock) → DI → hooks (incl. SSE).
4. UI: `GlassTabBar` (вынос) → rail в сайдбаре + переключатель вида → `WorkspaceChatPanel`
   (`ChatMessageList`/`ChatBubble`/`ChatComposer`/`ReactionPicker`) → умный скролл → анимации.
5. Интеграция `Sidebar.tsx` (минимальная, в конце) + бейдж непрочитанного.
6. Тесты на каждом слое.
