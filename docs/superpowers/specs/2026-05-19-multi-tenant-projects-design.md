# Spec: Многопользовательские проекты + инвайты

**Дата:** 2026-05-19
**Статус:** Утверждён (брейншторм), готов к фазе P1
**Зависит от:** [Spec #3 (Backend + Auth)](2026-05-14-backend-auth-design.md)
**Открывает дорогу для:** Уведомления (отдельная spec), упоминания в комментариях, аудит-лог.

---

## 1. Контекст и scope

### Зачем сейчас

ProjectsFlow задумывался как multi-tenant SaaS (см. CLAUDE.md → «Контекст проекта»). На данный момент модель — **1 user = 1 tenant**: проект имеет `owner_id`, все запросы фильтруются через `getByIdForOwner(id, ownerId)`. Нельзя пригласить коллегу, нельзя дать read-only доступ заказчику, нельзя обсудить задачу с подрядчиком. Уведомления тоже бессмысленны — нечему уведомлять, всё делает один и тот же юзер.

Это первый по-настоящему ломающий рефакторинг бекенда после Spec #3. Лучше делать спекой, а не «на лету» — слишком много мест нужно поправить синхронно.

### Что ВНУТРИ scope

**Модель доступа:**
- Таблица `project_members(project_id, user_id, role, joined_at)`. Уникальный ключ `(project_id, user_id)`. PK = композитный или сурогат.
- Роли: `owner`, `editor`, `viewer`. Owner — ровно один на проект (создатель), но может передаваться. Editor — полный CRUD задач/комментариев/коммитов. Viewer — read-only.
- Backward-compat: миграция переносит существующих `projects.owner_id` в `project_members(role='owner')`. Колонка `owner_id` остаётся как кеш «кто создал» (read-only), но **авторизация идёт исключительно через project_members**.

**Инвайты:**
- Таблица `project_invites(id, project_id, role, token, email, expires_at, accepted_at, accepted_by_user_id, created_by_user_id, created_at)`.
- Token — 32-byte random hex (как agent-token). Лимит TTL: 7 дней.
- Email опционален — для v1 owner копирует ссылку вручную (SMTP пока не подключён, см. секцию 7).
- Flow:
  1. Owner / editor открывает «Команда» в проекте → «Пригласить» → вводит email (опц.) + выбирает role.
  2. Server возвращает invite-URL вида `https://app.projectsflow.ru/invite/<token>`.
  3. Получатель открывает URL:
     - Не авторизован → редирект на `/register?invite=<token>` (после регистрации сразу accept).
     - Авторизован, другой email → может accept или decline (UX: «вас приглашают в проект X как editor»).
     - Авторизован, тот же email — accept автоматический.
  4. Accept: создаётся `project_members(project_id, user_id, role)`, `invites.accepted_at`/`accepted_by_user_id` заполняются. Токен становится одноразовым (повторный accept = 410 Gone).

**Auth-scoping рефакторинг:**
- Все `ProjectRepository.getByIdForOwner(id, ownerId)` → `getByIdForMember(id, userId)`, возвращающий проект + role или null.
- В use-cases добавляется проверка роли: чтение → `viewer+`, мутация → `editor+`, удаление проекта / передача владения / инвайт viewer'а / удаление member'а → `owner`.
- Декларативная матрица «action → required role» в одном месте (`server/src/domain/project/permissions.ts`). Use-case'ы через неё проходят, не катают копипасту.

**UI:**
- В шапке/настройках проекта новая секция «Команда»:
  - Список members с role-бейджем.
  - Кнопка «Пригласить» → диалог с email + role-selector.
  - После создания инвайта — поле с URL + кнопка «Скопировать».
  - Pending-инвайты с возможностью отозвать (DELETE).
  - Удалить member'а (только owner).
  - Передать владение (только owner — confirm-диалог).
- Sidebar: проекты юзера — это объединение «созданных» (owner) и «приглашённых» (editor/viewer). Уже сейчас `useProjects` фетчит через `/api/projects` — endpoint начнёт возвращать join'ом member-проекты.
- Карточка задачи / комментарий: автор теперь — реальный человек (не всегда current user, как сейчас в [CommentItem]). Avatar + displayName берутся из `users` таблицы по `ownerUserId`.

### Что СНАРУЖИ scope (следующие спеки)

| Тема | Куда |
|---|---|
| Email-уведомления (SMTP) | Отдельная — нужна выбор SMTP-провайдера и шаблоны |
| In-app уведомления (вкладка «Уведомления») | Отдельная, опирается на эту |
| @mention в комментариях | После уведомлений |
| Аудит-лог («Иван изменил статус задачи 2 мин назад») | Отдельная, после уведомлений |
| Organizations / workspaces | Сейчас project = единица. Org поверх — отдельная история, может и не понадобится |
| Public-link share (read-only без аккаунта) | Отдельная, удобно для «показать заказчику» |
| 2FA для owner'ов критичных проектов | Сильно позже |

---

## 2. Изменения схемы БД

### 2.1 Новые таблицы

```sql
-- Миграция 010_project_members.sql

CREATE TABLE project_members (
  project_id   CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  role         ENUM('owner', 'editor', 'viewer') NOT NULL,
  joined_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  KEY idx_project_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Бекфилл из projects.owner_id (выполняется тем же migration-файлом):
INSERT INTO project_members (project_id, user_id, role)
SELECT id, owner_id, 'owner' FROM projects;
```

```sql
-- Миграция 011_project_invites.sql

CREATE TABLE project_invites (
  id                   CHAR(36)     NOT NULL,
  project_id           CHAR(36)     NOT NULL,
  role                 ENUM('editor', 'viewer') NOT NULL,
  token                CHAR(64)     NOT NULL,
  email                VARCHAR(255) NULL,
  expires_at           TIMESTAMP    NOT NULL,
  accepted_at          TIMESTAMP    NULL,
  accepted_by_user_id  CHAR(36)     NULL,
  created_by_user_id   CHAR(36)     NOT NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invites_token (token),
  KEY idx_invites_project (project_id),
  KEY idx_invites_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`role` в инвайте — только `editor`/`viewer`. Owner передаётся отдельным endpoint'ом, не через инвайт.

### 2.2 Старые таблицы

`projects.owner_id` **не дропаем** в этой миграции — оставляем как кеш и для backward-compat. Но **код больше на него не ссылается** (всё через `project_members`). Удалять колонку — отдельной миграцией спустя релиз.

---

## 3. Permissions matrix

Один источник правды — `server/src/domain/project/permissions.ts`:

```ts
export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type ProjectAction =
  | 'read_project'
  | 'update_project'
  | 'delete_project'
  | 'create_task'
  | 'update_task'
  | 'delete_task'
  | 'move_task'
  | 'create_comment'
  | 'update_own_comment'
  | 'delete_own_comment'
  | 'delete_any_comment'
  | 'link_commit'
  | 'manage_kb'
  | 'invite_member'
  | 'remove_member'
  | 'transfer_ownership';

const REQUIRED_ROLE: Record<ProjectAction, ProjectRole> = {
  read_project: 'viewer',
  update_project: 'editor',
  delete_project: 'owner',
  create_task: 'editor',
  update_task: 'editor',
  delete_task: 'editor',
  move_task: 'editor',
  create_comment: 'viewer', // viewer тоже может оставлять комментарий
  update_own_comment: 'viewer',
  delete_own_comment: 'viewer',
  delete_any_comment: 'editor', // editor может удалить чужой комментарий
  link_commit: 'editor',
  manage_kb: 'editor',
  invite_member: 'owner',
  remove_member: 'owner',
  transfer_ownership: 'owner',
};

const ORDER: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

export function can(actorRole: ProjectRole, action: ProjectAction): boolean {
  return ORDER[actorRole] >= ORDER[REQUIRED_ROLE[action]];
}
```

Use-case'ы:

```ts
// Пример — UpdateTask
const membership = await this.deps.members.findForProject(input.projectId, input.userId);
if (!membership) throw new ProjectNotFoundError();
if (!can(membership.role, 'update_task')) throw new InsufficientRoleError(membership.role, 'update_task');
```

Доменная ошибка `InsufficientRoleError` маппится в errorHandler → `403 Forbidden` с message «Недостаточно прав».

---

## 4. Repository pattern

Новый `ProjectMemberRepository`:

```ts
type Membership = { projectId: string; userId: string; role: ProjectRole; joinedAt: Date };

interface ProjectMemberRepository {
  findForProject(projectId: string, userId: string): Promise<Membership | null>;
  listByProject(projectId: string): Promise<Array<Membership & { user: User }>>;
  listProjectsForUser(userId: string): Promise<Array<Project & { role: ProjectRole }>>;
  add(input: { projectId: string; userId: string; role: ProjectRole }): Promise<Membership>;
  remove(projectId: string, userId: string): Promise<boolean>;
  updateRole(projectId: string, userId: string, role: ProjectRole): Promise<Membership | null>;
}
```

`ProjectRepository.getByIdForOwner` исчезает. Вместо него use-case делает:

```ts
const membership = await members.findForProject(projectId, userId);
if (!membership) throw new ProjectNotFoundError();
// дальше membership.role используется для permission-check'ов
const project = await projects.getById(projectId); // без owner-фильтра
```

Это даёт **одну** проверку доступа на use-case вместо двух (раньше owner-фильтр был частью SQL-запроса).

`ListProjects.execute(userId)` идёт через `members.listProjectsForUser(userId)` — возвращает все проекты юзера независимо от роли + сам role-бейдж в DTO.

Новый `ProjectInviteRepository` — стандартный CRUD по invites + `findByToken(token)`.

---

## 5. HTTP endpoints

**Members:**
- `GET    /api/projects/:id/members` — список members + их users (требует viewer).
- `DELETE /api/projects/:id/members/:userId` — выгнать (owner; owner себя не может выгнать пока есть проект).
- `PATCH  /api/projects/:id/members/:userId` `{role}` — сменить роль (owner). Нельзя понизить себя если ты единственный owner.

**Invites:**
- `POST   /api/projects/:id/invites` `{role, email?}` — создать. Возвращает `{invite: {token, url, expiresAt, role, email}}`. URL формируется server-side из `APP_URL`.
- `GET    /api/projects/:id/invites` — pending-инвайты по проекту (owner).
- `DELETE /api/projects/:id/invites/:inviteId` — отозвать (owner).
- `GET    /api/invites/:token` — info об инвайте (anon-доступ; возвращает project name + role; не палит project_id внутрь без accept).
- `POST   /api/invites/:token/accept` — приложить инвайт к текущему юзеру. Требует session. 410 если истёк/использован.

**Ownership transfer:**
- `POST /api/projects/:id/transfer` `{toUserId}` — старый owner становится editor, новый — owner. Атомарно (транзакция).

---

## 6. Миграция данных (атомарно)

Файл `010_project_members.sql`:

1. `CREATE TABLE project_members ...`
2. `INSERT INTO project_members (project_id, user_id, role) SELECT id, owner_id, 'owner' FROM projects;`

Файл `011_project_invites.sql`: создаёт таблицу, инсертов нет.

Никаких манипуляций с существующими данными — `projects.owner_id` остаётся валидным во время роллаута. После выкатки кода старый код продолжит работать пока не задеплоен новый. Хитрость: новый код **не использует** `owner_id` — читает member-row. Это даёт окно безболезненного отката: можно откатить код, БД остаётся консистентной.

---

## 7. Решения (подтверждены)

1. **SMTP сейчас или потом? → ПОТОМ.** Запускаем без SMTP — owner копирует invite-URL вручную и шлёт через любой мессенджер. SMTP подключим отдельной spec'ой, когда понадобится «реальный шаринг». Поле email в форме инвайта остаётся опциональным — это пометка «для кого предназначено», не триггер отправки.
2. **Email инвайта vs email юзера-акцептора. → РАЗРЕШАЕМ MISMATCH.** Любой залогиненный юзер с действующим токеном может accept'ить — email на инвайте только информационный. UX-strings показывают «вас приглашают как editor», без проверки совпадения. Принимаем риск утечки ссылки (она и так шарится через незащищённые каналы — Telegram/Slack — и жёсткой проверки личности у нас нет).
3. **Inbox-проект — multi-user? → НЕТ, ОСТАЁТСЯ PERSONAL.** Проекты с `is_inbox=true` не имеют UI «Команда» и не принимают инвайты. Серверная валидация: `CreateProjectInvite` бросает ошибку, если `project.isInbox`. В sidebar inbox рендерится отдельным пунктом (как сейчас) и не сммешивается с member-проектами.

### Остаются как defaults (без отдельного запроса от юзера)

4. **Removed member — что с его комментариями?** Остаются (исторические, как в Slack: после выхода юзера его сообщения видны, имя/аватар остаются). User-row не удаляется (только глобальный delete-account делает что-то с этим).
5. **Sidebar: как показывать «приглашённые» vs «свои»?** Один общий список, члены с role≠owner получают маленький бейдж (`viewer`/`editor`) рядом с названием. Разделять на секции не стоит до момента, когда у юзера будет 20+ проектов.

---

## 8. Roll-out план (по фазам)

| Фаза | Содержание | Можно деплоить? |
|---|---|---|
| **P1: миграция БД + member-репо** | 010/011 миграции, `ProjectMemberRepository`, `ProjectInviteRepository`. Без UI и API. | Да — backward-compat |
| **P2: переписать use-cases на permissions matrix** | `getByIdForOwner` → `findForProject`+`can()`. Никаких новых эндпоинтов. | Да — поведение не меняется (owner есть в members) |
| **P3: invite endpoints + UI «Команда»** | `/api/projects/:id/invites`, `/api/invites/:token/accept`, страница `/invite/:token`, диалог «Пригласить» | Да — фичу можно скрыть фича-флагом до окончания тестов |
| **P4: дропнуть `projects.owner_id`** | Миграция 012, убрать поле из схемы и DTO | Только после нескольких релизов на P3 |

P1-P3 заходят отдельными PR'ами в этом порядке. Spec ревью между P2 и P3 — это удобная точка остановки, чтобы пересмотреть API-shape, если что-то пошло не как ожидалось.

---

## 9. Что НЕ делаем в этой spec'е

- Email-отправка (SMTP) — отдельная spec.
- In-app уведомления — отдельная spec, опирается на эту.
- @mentions в комментариях — после уведомлений.
- Activity feed по проекту — после уведомлений.
- Org / workspace абстракция — пока не нужна, проект остаётся top-level unit.
- Public read-only ссылки (без аккаунта) — отдельная фича, удобна для показа заказчику.

---

## 10. Risk-check

| Риск | Митигация |
|---|---|
| Сломаем существующих юзеров миграцией | Бекфилл атомарен в файле миграции; `owner_id` остаётся для отката |
| Permission-check забыли в новом use-case'е | Линт-правило / архитектурный тест: каждый use-case в `application/{feature}/*.ts` должен ссылаться на `can(...)` или `findForProject(...)` |
| Token утечка через логи | Не логируем body POST'а `/invites/*`; в URL только token, не email; expires_at короткий (7 дней) |
| Кто-то делает много pending-инвайтов и таблица пухнет | Не критично сейчас; в будущем — cleanup-job для accepted/expired старше 30 дней |
| Owner случайно понижает себя | UI блокирует «понизить себя если единственный owner», server тоже валидирует |

---

## Приложение A: примеры UX-стрингов (для UI-этапа)

- Пригласить: «Скопируй ссылку и отправь коллеге. Срок действия: 7 дней.»
- Принять invite: «Тебя пригласили в проект **{name}** с правами **редактор**. Принять?»
- Истёкший: «Срок действия приглашения истёк. Попроси у владельца новую ссылку.»
- Уже использованный: «Это приглашение уже использовано.»
- Передать владение: «Ты перестанешь быть владельцем проекта **{name}**. Останешься редактором. Передать?»

---

## Приложение B: что меняется в текущем коде (грубая оценка scope'а)

- **Server:** ~15 use-case'ов добавляют permission-check (1-2 строки каждый); 1 новый репо + 1 новый набор endpoints; миграция; permissions module.
- **Client:** новая страница `/invite/:token`, диалог «Команда» в `ProjectPage`; `useProjects` обогащается ролью (но shape совместимый); `CommentItem` фетчит автора через user-репо вместо `useCurrentUser`.
- **DI:** добавление member-репо в container'ах (client + server).
- **Тесты:** новые юнит-тесты для permissions matrix; интеграционный тест на accept-invite end-to-end.

Время: примерно ровно по фазе P1 ≈ 2-3 дня, P2 ≈ 2-3 дня, P3 ≈ 4-5 дней. Итого ~2 недели спокойной работы с буфером.
