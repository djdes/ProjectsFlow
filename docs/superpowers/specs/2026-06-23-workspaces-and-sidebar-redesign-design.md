# Пространства (workspaces) + редизайн шапки/профиля

**Дата:** 2026-06-23
**Статус:** Утверждён, ожидает плана реализации
**Тип:** Full-stack фича (БД, сервер, клиент, UI)

## 1. Контекст и цель

Сейчас слева снизу в сайдбаре висит блок профиля с переключателем темы, анимации,
ссылкой на мониторинг и профилем. Сверху — лого «PF / ProjectsFlow». Задача:

1. **Редизайн шапки/профиля.** Заменить лого на иконку активного **пространства** +
   его название. Этот блок становится триггером попап-меню. Старый нижний блок профиля
   удаляется полностью. Тема/анимация/мониторинг переезжают на страницу профиля.
2. **Пространства (workspaces).** Новый верхнеуровневый контейнер над проектами.
   Пространства полностью изолированы: каждое держит свои проекты, задачи и участников.
   Пользователь переключается между пространствами через попап; активное помечено галочкой.
   Можно создавать новые (пустые) пространства, управлять участниками и переносить проекты.

Референс UX — переключатель воркспейсов Notion (иконка+название сверху, попап с аккаунтом
и списком пространств, галочка у активного, «+ Новое пространство»).

## 2. Ключевые решения (зафиксированы при брейншторме)

- **Модель изоляции:** проект принадлежит **ровно одному** пространству. «Такой же проект»
  в другом пространстве — это отдельная сущность с тем же названием, свои задачи/участники.
  Реального шаринга одного проекта между пространствами нет.
- **Активное пространство** хранится на сервере (`users.current_workspace_id`) — единый
  источник правды, переживает перезагрузку.
- **Участники пространства** — отдельная сущность (`owner` | `member`). Проектные роли
  (`owner`/`editor`/`viewer`) остаются как есть. Доступ к проекту = участник его
  пространства **и** есть проектная роль.
- **Миграция:** каждому юзеру создаётся личное пространство, все его проекты переезжают туда,
  все текущие участники проектов добавляются в это пространство как `member`.
- **Объём:** full-stack сразу, включая управление участниками и перенос проектов.
- **Отложено:** загрузка кастомной картинки-аватара (остаётся эмодзи + первая буква);
  приглашение в пространство ещё не зарегистрированного пользователя (только по email
  существующего, как в текущем invite-паттерне проектов).

## 3. Модель данных

Новая миграция `db/073_workspaces.sql` (append-only, MariaDB-совместимый синтаксис).

Все id в платформенной схеме — `CHAR(36)` (UUID), генерируются в приложении. Базовая
схема: `db/002_platform_init.sql` (`users` с `email`/`display_name`/`avatar_url`;
`projects` с `id`/`owner_id`/`name`, UNIQUE(`owner_id`,`name`)), `db/010_project_members.sql`
(`project_members(project_id, user_id, role ENUM('owner','editor','viewer'))`).

### 3.1 Таблицы

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id            CHAR(36) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  icon          VARCHAR(16) NULL,                     -- эмодзи, NULL = дефолт (буква)
  owner_user_id CHAR(36) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workspaces_owner (owner_user_id),
  CONSTRAINT fk_workspaces_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id CHAR(36) NOT NULL,
  user_id      CHAR(36) NOT NULL,
  role         ENUM('owner','member') NOT NULL DEFAULT 'member',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  KEY idx_wm_user (user_id),
  CONSTRAINT fk_wm_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.2 Изменения существующих таблиц

```sql
ALTER TABLE projects ADD COLUMN workspace_id CHAR(36) NULL AFTER id;
ALTER TABLE users    ADD COLUMN current_workspace_id CHAR(36) NULL;
```

FK на `projects.workspace_id` и `users.current_workspace_id` добавляются **после** backfill,
чтобы ALTER не упал на NULL. Существующий UNIQUE(`owner_id`,`name`) на projects остаётся —
он не конфликтует с workspace_id (имя проекта по-прежнему уникально в рамках владельца).

### 3.3 Backfill (в той же миграции, после ALTER — чистый SQL)

Раннер (`scripts/migrate.mjs`) выполняет только SQL. Так как пространство одно на юзера и
коррелируется по `owner_user_id`, весь backfill делается на чистом SQL без app-кода.
Используем MariaDB `UUID()` — она возвращает строку формата CHAR(36), идентичную нашему
формату id; для одноразового backfill это допустимо (строки не сравниваются по версии UUID).

```sql
-- 1. Личное пространство каждому юзеру (один к одному по owner_user_id)
INSERT INTO workspaces (id, name, owner_user_id)
SELECT UUID(), 'Личное', id FROM users;

-- 2. Владелец — owner своего пространства
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT id, owner_user_id, 'owner' FROM workspaces;

-- 3. Все проекты юзера переезжают в его личное пространство
UPDATE projects p
JOIN workspaces w ON w.owner_user_id = p.owner_id
SET p.workspace_id = w.id;

-- 4. Остальные участники проектов → members пространства (расшаренные проекты не теряются)
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT p.workspace_id, pm.user_id, 'member'
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id <> p.owner_id;

-- 5. Активное пространство = личное
UPDATE users u
JOIN workspaces w ON w.owner_user_id = u.id
SET u.current_workspace_id = w.id;
```

После backfill: `projects.workspace_id` делаем `NOT NULL` (`MODIFY`), добавляем FK на
`projects.workspace_id` и `users.current_workspace_id`. Новый проект из приложения всегда
проставляет `workspace_id` = активное пространство создателя.

После backfill: каждый проект имеет ровно один `workspace_id`; каждый юзер имеет активное
пространство; расшаренные проекты не теряют участников.

## 4. Активное пространство и изоляция

- **Источник правды:** `users.current_workspace_id`.
- **`GET /api/projects`** фильтрует: `project.workspace_id = current_workspace_id`
  **AND** юзер есть в `project_members`. Inbox-phantom и счётчики считаются в рамках
  активного пространства.
- **Задачи** грузятся по проекту — изолируются автоматически (проект чужого пространства
  не появляется в списке, значит и его задачи недоступны через UI).
- **Переключение:** `PUT /api/workspaces/current { workspaceId }` (гард: юзер — участник
  этого пространства). Клиент инвалидирует кэш проектов → рефетч сайдбара/страниц.
- **Дип-линк** на проект из другого пространства: при заходе на `/projects/:id`, если
  `project.workspace_id !== current_workspace_id` и юзер — участник того пространства,
  сервер/клиент авто-переключает активное пространство на пространство проекта. Ссылки
  не ломаются. (Если юзер не участник пространства проекта — обычный 403/redirect, как сейчас.)

## 5. Сервер (Clean Architecture)

Зеркалит структуру существующих фич (project/task/live).

- **domain/workspace/**
  - `Workspace.ts` — `{ id, name, icon, ownerUserId, createdAt }`.
  - `WorkspaceMember.ts` — `{ workspaceId, userId, role }`.
  - `errors.ts` — `WorkspaceNotFoundError`, `NotWorkspaceMemberError`,
    `LastOwnerError`, `WorkspaceNotEmptyError`, `CannotDeleteLastWorkspaceError`.
- **application/workspace/**
  - `WorkspaceRepository.ts` (port).
  - `WorkspaceService.ts` + use-cases: `listMyWorkspaces`, `createWorkspace`,
    `renameWorkspace`, `setCurrentWorkspace`, `addMember`, `changeMemberRole`,
    `removeMember`, `moveProjectToWorkspace`, `deleteWorkspace`.
- **infrastructure/repositories/DrizzleWorkspaceRepository.ts** — реализация порта.
- **presentation/workspace/routes.ts** под `/api/workspaces` (cookie-auth):
  - `GET /` — мои пространства (с ролью текущего юзера и счётчиком проектов).
  - `POST /` — создать `{ name, icon? }` → возвращает новое пространство, делает его активным.
  - `PATCH /:id` — `{ name?, icon? }` (гард owner).
  - `PUT /current` — `{ workspaceId }` сменить активное (гард member).
  - `GET /:id/members`, `POST /:id/members` `{ email, role? }`, `PATCH /:id/members/:userId`,
    `DELETE /:id/members/:userId`.
  - `GET /:id/projects` — проекты пространства.
  - `POST /:id/projects/:projectId/move` `{ targetWorkspaceId }` — перенос (гард: project owner).
  - `DELETE /:id` — удалить пространство (гарды из §7).
- **Гарды:** `requireWorkspaceMember`, `requireWorkspaceOwner` — по образцу
  `requireProjectAccess`. Wiring в `index.ts`, mount в `presentation/http.ts`.

## 6. Клиент (Clean Architecture)

- **domain/workspace/Workspace.ts** — тип `Workspace` + `WorkspaceMember` + `WorkspaceRole`.
- **application/workspace/**
  - `WorkspaceRepository.ts` (port).
  - use-cases: `ListWorkspaces`, `CreateWorkspace`, `RenameWorkspace`, `SwitchWorkspace`,
    `ListWorkspaceMembers`, `AddWorkspaceMember`, `ChangeMemberRole`, `RemoveWorkspaceMember`,
    `MoveProject`, `DeleteWorkspace`.
- **infrastructure/http/HttpWorkspaceRepository.ts** — реальная реализация.
- **infrastructure/mock/MockWorkspaceRepository.ts** — мок (обязателен по правилам репо;
  даёт 1-2 демо-пространства для dev без бэка).
- Регистрация обоих в `infrastructure/di/container.tsx` (выбор адаптера как у прочих фич).
- **presentation/hooks/**: `useWorkspaces`, `useCurrentWorkspace`, `useSwitchWorkspace`,
  `useCreateWorkspace`, `useWorkspaceMembers`, и т.д. После switch/create/move —
  инвалидация `useProjects` (рефетч сайдбара). `presentation` ходит только через
  `useContainer()`, не импортирует адаптеры напрямую.

## 7. Правила (edge-cases)

- В пространстве всегда ≥1 owner. Последнего owner нельзя удалить или понизить до member
  (`LastOwnerError`).
- Нельзя удалить пространство, в котором есть проекты — сначала перенести/удалить их
  (`WorkspaceNotEmptyError`). Каскад не делаем (безопасность данных).
- Нельзя удалить своё последнее пространство (`CannotDeleteLastWorkspaceError`) — юзеру
  всегда нужно активное.
- Если удаляемое/покидаемое пространство было активным — авто-switch на любое другое
  доступное пространство юзера.
- Перенести проект может только его owner. При переносе все участники проекта
  авто-добавляются в целевое пространство как `member`, если их там ещё нет.
- Добавить участника можно только уже зарегистрированного по email
  (как текущий invite-паттерн проектов). Неизвестный email → ошибка «пользователь не найден».
- Новый проект создаётся в текущем активном пространстве (`workspace_id` = current).

## 8. UI

### 8.1 Шапка сайдбара (замена «PF / ProjectsFlow»)

- Иконка пространства (цветной квадрат: эмодзи `icon`, иначе первая буква названия;
  цвет детерминирован от названия через существующий `avatarColor`) + название активного
  пространства (truncate).
- Весь блок — кнопка-триггер попапа. На hover — лёгкий фон + появляется иконка-намёк
  (`ChevronsUpDown` / `⌄`), показывающая «кликабельно».
- Справа без изменений: поиск, колокольчик (с бейджем), тоггл сворачивания панели.

### 8.2 Попап (Radix DropdownMenu/Popover, открывается вниз от шапки)

Сверху вниз:
1. Мини-шапка аккаунта: email юзера + кнопка копирования (как в текущем `SidebarUserMenu`).
2. Пункты `Настройки` (бывш. «Профиль», → `/profile`) и `Выйти`.
3. Разделитель, заголовок «Пространства».
4. Список пространств — строка: иконка + название, активное помечено `✓`. На строке —
   иконка-шестерёнка (вход в настройки пространства `/workspaces/:id/settings`). Клик по
   строке (не по шестерёнке) другого пространства → попап закрывается, активное меняется,
   контент рефетчится.
5. `+ Новое пространство` → открывает модалку создания.

### 8.3 Модалка создания пространства

- Стиль сайта (shadcn Dialog). Поле «Название» (required), опционально выбор эмодзи-иконки
  (как у проектов). Кнопки «Создать» / крестик / Esc (отмена).
- На «Создать»: модалка закрывается, новое пространство появляется в попапе с галочкой,
  юзера перебрасывает в него (пустое, без проектов).

### 8.4 Страница настроек пространства (`/workspaces/:id/settings`)

- Переименование + смена эмодзи-иконки.
- Участники: список, добавить по email, сменить роль, удалить (с гардами §7).
- Проекты: список, перенос в другое пространство, удаление.
- Удаление пространства (с гардами §7).
- Маршрут в `presentation/app/routes.tsx`, гард доступа (участник пространства).

### 8.5 Профиль (`/profile`)

- Тема и анимация уже там (`PreferencesCard`) — остаются.
- Добавить карточку-вход «Мониторинг» (ссылка на `/monitoring`), т.к. из попапа убран.
- Заголовок страницы и пункт меню — «Настройки» (вместо «Профиль»).

### 8.6 Нижний блок сайдбара

- Удаляется полностью (`SidebarUserMenu` в текущем виде + блок тема/анимация/мониторинг).
- Ссылка «Администрирование» (для админов) остаётся отдельным пунктом навигации в сайдбаре.

### 8.7 Свёрнутый сайдбар (icon-rail)

- Вверху иконка активного пространства = триггер того же попапа (через `compact`-режим).
- Нижний аватар-юзер убирается.

## 9. Анимации (требование «побольше»)

Всё под флагом `useMotion` (+ `prefers-reduced-motion`); при выключенных — без движения.

- Попап: fade + slide-up + лёгкий scale на открытии (Radix `data-state`).
- Галочка активного пространства: spring-pop при переключении.
- Модалка создания: backdrop fade + контент scale-in.
- Hover на шапке: плавное появление иконки-намёка + микро-сдвиг.
- Смена названия пространства при переключении: короткий crossfade.

## 10. Тестирование

- **Сервер:** unit-тесты `WorkspaceService` (создание, switch, гарды §7: last owner,
  not-empty, last-workspace, move-project auto-add members). Тесты роутов (auth-гарды,
  изоляция — юзер не видит проекты чужого пространства).
- **Миграция:** тест backfill на фикстуре (юзер с расшаренным проектом → оба становятся
  участниками пространства владельца; проект получает workspace_id).
- **Клиент:** тесты use-cases на моках; smoke-тест переключения (после switch `useProjects`
  инвалидируется).

## 11. Порядок реализации (для плана)

1. Миграция `db/073` + backfill.
2. Сервер: domain → application (port + service) → infrastructure (Drizzle) →
   presentation (routes + guards) → wiring.
3. Scoping существующего `GET /api/projects` и дип-линк-авто-switch.
4. Клиент: domain → application → infrastructure (http + mock) → DI → hooks.
5. UI: шапка-триггер + попап + переключение → модалка создания → удаление нижнего блока →
   профиль (мониторинг-карточка, переименование) → страница настроек пространства →
   анимации.
6. Тесты на каждом слое.

## 12. Вне scope (следующие итерации)

- Загрузка кастомной картинки-иконки пространства/аватара.
- Приглашение в пространство по email ещё не зарегистрированного пользователя.
- Биллинг/планы/лимиты пространств (на скрине Notion «Free Plan · 5 members» — не делаем).
