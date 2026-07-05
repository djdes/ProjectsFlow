# Spec: окно Share/Publish + публичные ссылки досок

- **Дата:** 2026-07-05
- **Статус:** утверждён, готов к плану реализации
- **Тема:** окно «Поделиться» в стиле Notion (вкладки Share / Publish) + система публичных ссылок на доску проекта

## 1. Проблема и цель

Кнопка «Поделиться» на странице проекта ([client/src/presentation/pages/TasksPage.tsx:168](../../../client/src/presentation/pages/TasksPage.tsx#L168))
— заглушка без `onClick`. Плашка «проект опубликован»
([client/src/presentation/components/project/ProjectPublishedBanner.tsx](../../../client/src/presentation/components/project/ProjectPublishedBanner.tsx))
— мок, строит фейковый адрес `<email>.projectsflow.ru` и никуда не ведёт.

Нужно:
1. Окно «Поделиться» с двумя вкладками **Share** и **Publish**, визуально «пиксель-в-пиксель»
   как в Notion (см. референс-скрины в задаче). Функции, которых пока нет, показываем серыми
   (disabled), но на своих местах.
2. **Публичную ссылку доски** — у каждого опубликованного проекта своя ссылка с обложкой,
   названием, описанием и задачами по колонкам. Аноним по ссылке видит доску read-only.

Вне scope (задел оставить, но **не** реализовывать сейчас):
- Публичная ссылка «на результат воркера».
- Сабдомены как у Notion (`<slug>.projectsflow.ru`) — только задел в архитектуре.
- Полноценный SSR-SEO публичной страницы.

## 2. Принятые решения

| Вопрос | Решение | Почему |
|---|---|---|
| Схема ссылки | **path + случайный slug**: `projectsflow.ru/p/<slug>` | slug всё равно случайный и в сабдомене (Notion: `cookie-opinion-b69`); path не требует wildcard DNS/TLS/nginx и работает сразу |
| Задел под сабдомен | slug в БД, URL собирает один хелпер `publicBoardUrl(slug)` | переход на сабдомен = правка только хелпера + nginx, модель данных не меняется |
| Что публикуем | обложка + иконка + имя + описание проекта + канбан-задачи (title, description, status, icon, cover, priority, deadline) | публичный обзор проекта; комментарии — внутренняя переписка |
| Что НЕ публикуем | комментарии, финансы, участники, креды, LIVE-сессии, `owner_id` | приватность / ПДн |
| Функции Publish (реальные) | Publish/Unpublish, Copy link, View site, тоггл Search engine indexing | минимально полезный публичный сайт |
| Функции Publish (серые) | Customize site styling, Duplicate as template, Manage all sites, Embed this page, Share via social | косметика/сложное — потом |
| Кто публикует | только `owner` | публикация раскрывает данные наружу — как `set_publish_settings` (owner-only) |
| Unpublish | `is_public=0`, slug сохраняется | повторная публикация возвращает тот же URL (как в Notion) |

## 3. Модель данных

Миграция `db/096_project_public_link.sql` (append-only, MariaDB-совместимо; highest сейчас — `095`).
К таблице `projects` добавить:

| Колонка | Тип | Смысл |
|---|---|---|
| `public_slug` | `VARCHAR(64) UNIQUE NULL` | случайный slug `adjective-noun-hex`. NULL = никогда не публиковали |
| `is_public` | `TINYINT(1) NOT NULL DEFAULT 0` | опубликовано сейчас или нет |
| `public_indexing` | `TINYINT(1) NOT NULL DEFAULT 0` | тоггл индексации поисковиками (по умолчанию Off) |
| `published_at` | `TIMESTAMP NULL` | момент первой публикации |

UNIQUE-индекс по `public_slug` (частичной уникальности MariaDB не даёт — уникальность по NULL
не конфликтует, т.к. несколько NULL допустимы).

## 4. Архитектура по слоям (Clean Architecture)

### domain
- `server/src/domain/project/publicSlug.ts` — чистая функция-генератор slug формата
  `<прилагательное>-<существительное>-<3–4 hex>` (стиль Notion). Небольшие словари в том же
  файле. Функция сама по себе не гарантирует уникальность — retry делает infra при коллизии.
- `server/src/domain/project/Project.ts` и `client/src/domain/project/Project.ts` —
  добавить поля `publicSlug: string | null`, `isPublic: boolean`, `publicIndexing: boolean`,
  `publishedAt: string | null`.
- Тип публичной выдачи `PublicBoard` (domain, отдельный от `Project`):
  ```
  PublicBoard {
    slug, icon, name, description, coverUrl, coverPosition, indexing,
    columns: Array<{ status, tasks: PublicTask[] }>
  }
  PublicTask { id, title, description, status, icon, cover, coverPosition, priority, deadline }
  ```
  **Это единственная граница приватности** — только эти поля покидают периметр.

### application
- `ProjectRepository` (порт) — добавить `getBySlug(slug): Promise<Project | null>` и поля
  публикации в `UpdateProjectInput` (или отдельные методы `setPublish`, `setIndexing`).
- Use-cases (`server/src/application/project/`):
  - `PublishProject` — owner-only. Если `public_slug` пуст — генерирует (retry на UNIQUE),
    ставит `is_public=1`, `published_at=NOW()` (если ещё не стоял). Возвращает `{ slug }`.
  - `UnpublishProject` — owner-only. `is_public=0`. slug и `published_at` не трогает.
  - `SetPublicIndexing` — owner-only. `public_indexing = bool`.
  - `GetPublicBoard(slug)` — берёт проект по slug где `is_public=1`; если нет — `null`.
    Собирает `PublicBoard`: читает задачи проекта (реюз существующего листинга задач),
    маппит в `PublicTask[]`, группирует по колонкам канбана. Порядок колонок — как в
    `TaskStatus` / `kanban_settings` проекта.
- Права: добавить action `manage_public_link` (требует `owner`) в
  `server/src/domain/project/permissions.ts` (`ProjectAction` + `REQUIRED_ROLE`).

### infrastructure
- `DrizzleProjectRepository` — реализовать `getBySlug`, патч новых полей, генерацию slug
  с retry на `ER_DUP_ENTRY` (несколько попыток, потом ошибка).

### presentation
**Авторизованные роуты** (в `projectsRouter`, под `requireProjectAccess(... 'manage_public_link')`):
- `POST   /api/projects/:id/publish` → `{ slug, url }`
- `DELETE /api/projects/:id/publish` → снять с публикации
- `PATCH  /api/projects/:id/publish` → тело `{ indexing: boolean }`

**Анонимные роуты** — новый роутер (напр. `server/src/presentation/public/routes.ts`),
монтируется в `server/src/presentation/http.ts` **до** `requireAuth` (рядом с `/api/invites` GET):
- `GET /api/public/boards/:slug` → JSON `PublicBoard`; 404 если проект не найден или `is_public=0`
  (существование приватных досок не раскрываем — всегда 404).
- `GET /api/public/boards/:slug/cover` → стримит обложку-картинку опубликованной доски.
  Реюз логики отдачи файла из существующего cover-роута, но гейт — «проект публичный по slug»,
  а не membership. Градиенты (`gradient:<id>`) — чистый CSS, роут для них не нужен.

**Фронт (SPA):**
- Роут `/p/:slug` в `client/src/presentation/app/routes.tsx` → компонент `PublicBoardPage.tsx`
  **вне** основного шелла (без сайдбара, без auth-гейта). Фетчит `/api/public/boards/:slug`.
  Рендер: `ProjectCover` (реюз) → иконка + имя → описание → read-only канбан (лёгкий
  `PublicKanban` или `KanbanBoard` в read-only режиме — без drag, без создания, без меню).
  Обложка-картинка тянется с `/api/public/boards/:slug/cover`.
- `<meta name="robots" content="noindex">` когда `indexing=false` (ставим на клиенте при
  монтировании страницы). Полноценный краулер-friendly SSR — отдельная задача «потом»
  (зафиксировать как известное ограничение).
- Хелпер `publicBoardUrl(slug)` (один на клиент, один на сервер) — единственное место сборки
  URL; сегодня возвращает `${origin}/p/${slug}`.

## 5. UI — окно Share

`client/src/presentation/components/project/ProjectSharePopover.tsx`, якорь — кнопка «Поделиться»
([TasksPage.tsx:168](../../../client/src/presentation/pages/TasksPage.tsx#L168)). Radix `Popover`
(паттерн из [MemberAvatarStack.tsx](../../../client/src/presentation/components/project/MemberAvatarStack.tsx)).
Две вкладки-таба **Share | Publish**.

### Вкладка Share (референс-скрин 1)
- Поле «Email or group, separated by commas» + кнопка **Invite**.
- Строка владельца: аватар, «\<Имя> (You)», email, справа «Full access».
- Строки участников с дропдауном роли (owner/editor/viewer из `project_members`).
- Секция «General access» → строка «Everyone at \<workspace>» (имя из `workspace_id`).
- «Page-level access → Add a new rule».
- Низ: «Learn about sharing» + «Copy link».
- **Реально:** инвайт по email (реюз существующего инвайт-флоу — `InviteDialog` /
  `MembersInviteForm`), список участников, «Copy link».
- **Серым (disabled):** дропдауны General access, «Add a new rule», «Learn about sharing».

### Вкладка Publish (референс-скрины 2–3)
- **Не опубликовано:** заголовок «Publish to web / Create a website», карточка-превью
  (мини-доска: обложка + иконка + имя проекта), синяя кнопка **Publish**, сноска
  «When published to web, anyone with the link can view this page's content».
- **Опубликовано:** поле-URL `projectsflow.ru/p/<slug>` + иконка копирования; строки:
  Customize site styling (серое), **Search engine indexing** (реальный тоггл, Off/On),
  Duplicate as template (серое), Manage all sites and links (серое), Embed this page (серое),
  Share via social (серое); кнопки **Unpublish** + **View site** (реальные, View site
  открывает `/p/<slug>`).

## 6. Плашка «проект опубликован»

Перепаять [ProjectPublishedBanner.tsx](../../../client/src/presentation/components/project/ProjectPublishedBanner.tsx)
на реальное состояние (`is_public` + `public_slug`): показывать только когда реально
опубликовано; «Показать сайт» открывает `/p/<slug>`; убрать генерацию фейкового
`<email>.projectsflow.ru`. Локальный dismiss сохранить как есть.

## 7. Тестирование

- **domain:** генератор slug (формат `adj-noun-hex`, детерминированный при фиксированном
  источнике случайности); проверка, что `PublicBoard`/`PublicTask` не содержат
  comments/finance/members/ownerId.
- **application:** `PublishProject` генерирует и сохраняет slug, owner-guard (403 для
  editor/viewer), повторная публикация не меняет slug; `UnpublishProject` не стирает slug;
  `GetPublicBoard` → `null` для неопубликованных и неизвестных slug; read-model исключает
  скрытые поля.
- **integration:** `GET /api/public/boards/:slug` → 200 для публичной доски **без cookie**,
  404 для неопубликованной/неизвестной; `POST/DELETE/PATCH …/publish` — owner-gated
  (403 для editor/viewer, 404 если не участник).
- **UI:** попап открывается на кнопке; переключение вкладок; publish-флоу меняет состояние
  (появляется URL, Unpublish/View site); серые контролы `disabled`; «Copy link» кладёт в
  буфер `projectsflow.ru/p/<slug>`.

## 8. Границы и изоляция

- `PublicBoard` DTO — единственная точка, решающая что утекает наружу. Меняешь список полей
  в одном месте.
- Анонимный роутер — отдельный файл, смонтирован до `requireAuth`; не имеет доступа к
  membership-логике, только slug-lookup.
- `publicBoardUrl(slug)` — единственная сборка URL; развязывает идентификатор (slug в БД) и
  форму URL (path сейчас, сабдомен потом).

## 9. Известные ограничения (осознанно «потом»)

- Индексация honor-ится только через клиентский `<meta robots>`; настоящий SSR для краулеров —
  отдельная задача.
- Публичная ссылка «на результат воркера» — не в этом spec; slug спроектирован реюзабельным
  (`/p/<slug>/result` в будущем).
- Сабдомены — только архитектурный задел (хелпер URL), без реализации.
