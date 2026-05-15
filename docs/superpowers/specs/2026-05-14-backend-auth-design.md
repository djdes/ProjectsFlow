# Spec #3: Backend + Auth (real persistence)

**Дата:** 2026-05-14
**Статус:** Утверждён (брейншторм)
**Зависит от:** [Spec #1 (UI-skeleton)](2026-05-14-platform-ui-skeleton-design.md), [Spec #2 (project creation)](2026-05-14-project-creation-design.md)

---

## 1. Контекст и scope

### Цель

Заменить mock-layer на реальный backend: MySQL + Express + Drizzle ORM. Добавить аутентификацию (email + пароль). После этой спеки данные переживают перезагрузку, у каждого пользователя свой набор проектов, регистрация открыта.

### Что ВНУТРИ scope

**Server:**
- MySQL 9.6 (локально на Windows, БД `projectsflow`, dedicated user `projectsflow`).
- Drizzle ORM + drizzle-kit для миграций.
- Express 4 (уже в deps) + cookie-parser + zod.
- argon2id для паролей.
- Domain → Application → Infrastructure → Presentation слои в `server/src/`.
- Таблицы: `users`, `sessions`, `projects`.
- Эндпоинты:
  - `POST /api/auth/register` — создать аккаунт + сразу залогинить.
  - `POST /api/auth/login` — выдать cookie-сессию.
  - `POST /api/auth/logout` — удалить сессию.
  - `GET /api/auth/me` — текущий user (или 401).
  - `PATCH /api/auth/me` — изменить displayName/email.
  - `GET /api/projects` — список проектов текущего user.
  - `GET /api/projects/:id` — один проект, если принадлежит user'у.
  - `POST /api/projects` — создать.
- Middleware:
  - `sessionFromCookie` — на каждый запрос, тащит user из cookie.
  - `requireAuth` — на защищённые роуты, 401 если нет user'а.
  - `errorHandler` — централизованный, маппит доменные ошибки → HTTP-статусы.

**Client:**
- `HttpProjectRepository implements ProjectRepository` — fetch к `/api/projects/*`.
- `HttpUserRepository implements UserRepository` — fetch к `/api/auth/me`.
- Use-cases `Register`, `Login`, `Logout` — новые в application/.
- `AuthProvider` + `useAuth()` хук — общий стейт «вошёл/не вошёл».
- `ProtectedRoute` — компонент-обёртка, редиректит на `/login` если не залогинен.
- Страницы `/login`, `/register`.
- DI-контейнер: `MockProjectRepository` → `HttpProjectRepository`, `MockUserRepository` → `HttpUserRepository`.

**Infrastructure:**
- DB-юзер с правами на `projectsflow.*`.
- `.env` с реальными значениями для dev.
- devtunnel переключается с `--allow-anonymous` на authed-режим (только GitHub-allowlist).

### Что СНАРУЖИ scope (отдельные будущие спеки)

| Тема | Куда |
|---|---|
| Email-верификация | Когда подключим SMTP |
| Password recovery | После SMTP |
| OAuth (GitHub/Google) | Отдельная спека |
| Magic-link login | Отдельная |
| Rate limiting на login | Когда придут реальные юзеры |
| 2FA | Когда понадобится |
| Organizations / коллабораторы | Отдельная спека, потребует data migration |
| Деплой backend на прод-VPS | Отдельная (требует прод-MariaDB + PM2 wiring) |
| Поля Project: URL/git/описание/теги/стек | Отдельные секционные спеки |

---

## 2. БД и Drizzle

### 2.1 Подготовка БД

В локальном MySQL 9.6:

```sql
CREATE DATABASE projectsflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'projectsflow'@'localhost' IDENTIFIED BY '<dev-password>';
GRANT ALL ON projectsflow.* TO 'projectsflow'@'localhost';
FLUSH PRIVILEGES;
```

Пароль для dev — в `.env`, генерируется случайно.

### 2.2 Schema (Drizzle)

`server/src/infrastructure/db/schema.ts`:

```ts
import { mysqlTable, char, varchar, datetime, mysqlEnum, uniqueIndex, index } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: char('id', { length: 36 }).primaryKey(),                // UUID v4
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdate(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uniqEmail: uniqueIndex('uq_users_email').on(t.email),
}));

export const sessions = mysqlTable('sessions', {
  id: char('id', { length: 36 }).primaryKey(),
  userId: char('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: datetime('expires_at').notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  idxUser: index('idx_sessions_user').on(t.userId),
  idxExpires: index('idx_sessions_expires').on(t.expiresAt),
}));

export const projects = mysqlTable('projects', {
  id: char('id', { length: 36 }).primaryKey(),
  ownerId: char('owner_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  status: mysqlEnum('status', ['active', 'paused', 'archived']).notNull().default('active'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdate(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uniqOwnerName: uniqueIndex('uq_projects_owner_name').on(t.ownerId, t.name),
  idxOwner: index('idx_projects_owner').on(t.ownerId),
}));
```

Важно: `uq_projects_owner_name` — uniqueness уникальна **в пределах одного владельца**. Разные пользователи могут иметь проекты с одинаковыми именами.

### 2.3 Миграции

`drizzle.config.ts` в корне `server/`:

```ts
import type { Config } from 'drizzle-kit';
export default {
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
```

Команды:
- `npm run db:generate` → drizzle-kit generates new migration from schema diff.
- `npm run db:push` (только в dev) → применить schema напрямую.
- `npm run db:migrate` → применить generated migrations.

Старая `db/001_init.sql` (от лендинга) — не трогаем, в новой БД её нет. `scripts/migrate.mjs` (старый кастомный мигратор) можно удалить — Drizzle берёт на себя.

---

## 3. Domain layer (server)

`server/src/domain/`:

- `user/User.ts` — `{ id, email, displayName, avatarUrl, createdAt }`. Без `passwordHash` — это секрет инфраструктуры, не утекает в domain.
- `user/errors.ts` — `UserEmailAlreadyExistsError`, `InvalidCredentialsError`.
- `session/Session.ts` — `{ id, userId, expiresAt, createdAt }`.
- `project/Project.ts` — `{ id, ownerId, name, status, createdAt }`. То же что на клиенте + `ownerId`.
- `project/errors.ts` — `ProjectNameAlreadyExistsError`, `ProjectNotFoundError`, `ProjectAccessDeniedError`.

Domain — чистый TS, без зависимостей.

---

## 4. Application layer (server)

`server/src/application/`:

- `auth/AuthRepository.ts` (?) — нет, разделим:
  - `user/UserRepository.ts` — `getById/getByEmail/create/updateProfile`.
  - `session/SessionRepository.ts` — `create/getById/delete/deleteAllForUser`.
- `auth/Register.ts` — use-case: валидирует, хеширует, создаёт user, создаёт session.
- `auth/Login.ts` — use-case: ищет user, верифицирует пароль, создаёт session.
- `auth/Logout.ts` — удаляет session.
- `project/ProjectRepository.ts` — те же методы что на клиенте + scope по `ownerId`.
- `project/ListProjects.ts` — `execute(ownerId)`.
- `project/CreateProject.ts` — `execute(ownerId, name)`.
- `project/GetProject.ts` — `execute(ownerId, id)` — возвращает null или ошибку доступа.

**Ключевое:** use-cases для проектов принимают `ownerId` явно. Репозиторий обязан добавить `WHERE owner_id = ?` во все запросы. Middleware на presentation-слое передаёт `currentUser.id` в use-case.

---

## 5. Infrastructure layer (server)

`server/src/infrastructure/`:

- `db/index.ts` — `mysql2/promise` pool + drizzle instance.
- `db/schema.ts` — see §2.2.
- `repositories/DrizzleUserRepository.ts` — реализует `UserRepository` через drizzle.
- `repositories/DrizzleSessionRepository.ts` — то же для sessions.
- `repositories/DrizzleProjectRepository.ts` — то же для projects, с автоматическим scope по `ownerId`.
- `crypto/passwordHasher.ts` — обёртка над `argon2`. Методы `hash(plain)` / `verify(plain, hash)`.
- `id/idGenerator.ts` — обёртка над `crypto.randomUUID()`.

Маппинг drizzle-row → domain entity делается в репо (явный `mapRowToProject` функция). Domain не знает про drizzle.

---

## 6. Presentation layer (server)

`server/src/presentation/`:

- `http.ts` — собирает Express app: middleware + routes.
- `middleware/sessionFromCookie.ts` — читает cookie `pf_session`, валидирует, прикладывает `req.user`.
- `middleware/requireAuth.ts` — 401 если `req.user` нет.
- `middleware/errorHandler.ts` — маппит ошибки domain → HTTP:
  - `UserEmailAlreadyExistsError` → 409
  - `InvalidCredentialsError` → 401
  - `ProjectNameAlreadyExistsError` → 409
  - `ProjectNotFoundError` → 404
  - `ProjectAccessDeniedError` → 403
  - `ZodError` → 400 с деталями
  - прочие → 500 (логируем server-side, не утекаем в респонс)
- `auth/routes.ts` — `POST /register`, `POST /login`, `POST /logout`, `GET /me`, `PATCH /me`.
- `auth/schemas.ts` — zod-схемы для тел запросов.
- `projects/routes.ts` — `GET /`, `GET /:id`, `POST /`.
- `projects/schemas.ts` — zod-схемы.

### Cookie session

- Имя: `pf_session`.
- Значение: session.id (UUID).
- Флаги: `httpOnly=true`, `sameSite='lax'`, `secure=NODE_ENV==='production'`.
- Срок: 30 дней (можно настроить через env, на старте — хардкод).
- `req.user` появляется на каждом запросе если cookie валиден и сессия не истекла.

### CORS

Dev: Vite на 5173 → Express на 4317. Разные порты → нужен CORS. В dev — разрешаем `http://localhost:5173` и `https://*.devtunnels.ms` (origin туннеля). В prod (когда раскатим) — same-origin, CORS не нужен.

`credentials: 'include'` на стороне клиента и `Access-Control-Allow-Credentials: true` на сервере, иначе cookie не пойдут.

---

## 7. Client изменения

### 7.1 HTTP-репозитории

`client/src/infrastructure/http/`:

- `httpClient.ts` — обёртка над `fetch`, добавляет `credentials: 'include'`, базовый URL `/api`, JSON-парсинг, ошибки.
- `HttpProjectRepository.ts` — реализует `ProjectRepository`. Методы маппятся 1:1 на эндпоинты.
- `HttpUserRepository.ts` — реализует `UserRepository`. Использует `GET /me` для `getCurrent` и `PATCH /me` для `updateProfile`.

### 7.2 Auth-слой

`client/src/application/auth/`:
- `AuthRepository.ts` — порт с `register/login/logout`.
- `Register.ts`, `Login.ts`, `Logout.ts` — use-cases.

`client/src/infrastructure/http/HttpAuthRepository.ts` — реализация.

### 7.3 AuthProvider + ProtectedRoute

`client/src/presentation/auth/`:
- `AuthProvider.tsx` — на маунте делает `GET /me`, держит состояние `{ user, loading }`. Экспонирует `useAuth()`.
- `ProtectedRoute.tsx` — компонент-обёртка для роутов. Если `loading` — skeleton. Если no-user — `<Navigate to="/login" replace />`. Иначе — children.
- `LoginPage.tsx` — форма email + пароль, submit вызывает Login use-case, на успехе `applyUpdate(user)` + `navigate('/')`.
- `RegisterPage.tsx` — форма email + displayName + пароль, submit вызывает Register use-case, поведение как Login.

### 7.4 Routes

`presentation/app/routes.tsx`:

```tsx
[
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/',
    element: <ProtectedRoute><AppShell /></ProtectedRoute>,
    children: [...same as before...]
  }
]
```

Защищены `/`, `/projects/*`, `/profile`. `/login` и `/register` доступны без auth.

### 7.5 DI swap

`infrastructure/di/container.tsx`:

```ts
function buildContainer(): Container {
  const projectRepo = new HttpProjectRepository(httpClient);
  const userRepo = new HttpUserRepository(httpClient);
  const authRepo = new HttpAuthRepository(httpClient);
  // ...use-cases
}
```

Mock-репозитории не удаляем — пригодятся для Storybook/тестов. Просто не используем в продовом контейнере.

### 7.6 CurrentUserProvider → опирается на AuthProvider

`useCurrentUser()` теперь возвращает user из AuthProvider, а не из HttpUserRepository. Один источник правды.

`useUpdateProfile()` остаётся, но дёргает `HttpUserRepository.updateProfile()`, на успехе обновляет состояние в AuthProvider через тот же `applyUpdate`-pattern.

---

## 8. Конфигурация / .env

Корневой `.env` (расширяем существующий):

```
NODE_ENV=development
PORT=4317

# DB
DATABASE_URL=mysql://projectsflow:<dev-password>@127.0.0.1:3306/projectsflow

# Session
SESSION_COOKIE_NAME=pf_session
SESSION_TTL_DAYS=30
```

`.env.example` отражает структуру без секретов.

В dev фронт обращается к `http://localhost:4317/api/*` через Vite proxy (см. ниже).

### Vite proxy

`vite.config.ts` добавляет proxy в dev-режиме:

```ts
server: {
  proxy: {
    '/api': 'http://localhost:4317',
  },
}
```

Через туннель: запросы клиент → туннель → Vite dev-сервер → Vite proxy → Express на 4317. Cookie работают потому что origin для браузера = домен туннеля, fetch идёт same-origin, проксируется на бэк прозрачно.

---

## 9. Туннель: убираем анонимный доступ

Сейчас туннель в `--allow-anonymous`. После Spec #3 в БД будут реальные пользователи — открывать анонимно нельзя.

Команда переключения:

```powershell
# остановить текущий
# (через TaskStop в Claude или Ctrl+C в терминале)
devtunnel host -p 5173    # БЕЗ --allow-anonymous
```

После этого открыть туннельный URL смогут только GitHub-аккаунты из ACL туннеля. Чтобы дать доступ конкретному GitHub-юзеру:

```
devtunnel access create --tunnel <id> --user-github <username>
```

Это надо ровно один раз. В dev — пользователь = ты сам, доступ уже есть через owner-permission.

---

## 10. Acceptance criteria

### Сборка / запуск
- [ ] `npm install` в корне без ошибок (server + client).
- [ ] MySQL-юзер `projectsflow` создан, БД `projectsflow` существует.
- [ ] `npm run db:push` (или `db:migrate`) применяет schema без ошибок.
- [ ] `npm run dev:server` поднимает Express на 4317.
- [ ] `npm run dev:client` поднимает Vite на 5173, проксирует `/api/*` на :4317.
- [ ] `npm run dev` поднимает обе одновременно (concurrently).
- [ ] `npm run typecheck` чистый для обоих воркспейсов.
- [ ] `npm run lint` чистый для client.
- [ ] `npm run build` чистый для обоих.

### Auth flow
- [ ] `POST /api/auth/register` с email+пароль+displayName создаёт user, возвращает 201 + Set-Cookie.
- [ ] Повторная регистрация на тот же email — 409 `UserEmailAlreadyExistsError`.
- [ ] `POST /api/auth/login` с правильным паролем — 200 + Set-Cookie.
- [ ] Неправильный пароль — 401 `InvalidCredentialsError`.
- [ ] `GET /api/auth/me` без cookie — 401.
- [ ] `GET /api/auth/me` с валидной cookie — 200 + user.
- [ ] `POST /api/auth/logout` удаляет cookie и сессию из БД.
- [ ] `PATCH /api/auth/me` меняет displayName/email текущего user, отражается в `GET /me`.

### Project flow (scoped)
- [ ] `GET /api/projects` без auth — 401.
- [ ] `POST /api/projects` создаёт проект с `owner_id = current_user.id`.
- [ ] `GET /api/projects` возвращает ТОЛЬКО проекты текущего user.
- [ ] `GET /api/projects/:id` чужого проекта — 403 (или 404, чтобы не утекать существование) — выбираем 404 для simplicity.
- [ ] Дубликат имени проекта в пределах user'а — 409.
- [ ] Дубликат имени проекта МЕЖДУ разными users — OK (создаётся).

### Frontend flow
- [ ] `/login` и `/register` доступны без auth.
- [ ] Любой другой роут редиректит на `/login` если не залогинен.
- [ ] Успешная регистрация → редирект на `/`.
- [ ] Успешный login → редирект на `/`.
- [ ] Logout из user-меню → редирект на `/login`, cookie удалена.
- [ ] При refresh страницы — состояние auth восстанавливается (GET /me на маунте).
- [ ] Создание проекта в UI → реально пишется в БД, виден на refresh.
- [ ] Изменение displayName в /profile → реально пишется в БД, при refresh сохраняется.

### Architecture
- [ ] Server-слои соблюдают clean architecture (domain не зависит от ничего, application от domain, presentation не зовёт repositories напрямую).
- [ ] ESLint boundaries на client (если в server тоже добавим — ок) ловят нарушения.
- [ ] Mock-репозитории остаются в кодовой базе клиента, но не используются в продовом DI.

### Безопасность
- [ ] Cookie `pf_session` — httpOnly + sameSite=lax.
- [ ] Пароль хранится только как argon2id-hash, в логах не появляется.
- [ ] Туннель НЕ в `--allow-anonymous` режиме.
- [ ] Доменные ошибки не утекают через 500-респонс. Server-side логи — да, клиенту — только статус-код + неинформативное сообщение.

---

## 11. Открытые вопросы (решения по ходу)

1. **404 vs 403 на чужой проект?** Выбираем 404 — не утекаем существование чужих ресурсов. Свой проект найден → 200, чужой проект существует → 404 (для запрашивающего его нет).
2. **Pessimistic uniqueness check в `CreateProject`?** Нет — полагаемся на DB UNIQUE constraint, ловим ошибку и переводим в `ProjectNameAlreadyExistsError`. Атомарно, нет race.
3. **Длина пароля?** 8+ символов на регистрации. На login — длину не валидируем (пусть пользователь введёт что есть, всё равно verify провалится).
4. **Sliding session expiry?** Нет — фиксированный 30-дневный срок. Логин дольше — relogin. Простая логика, можно усложнить позже.

---

## 12. Риски

| Риск | Митигация |
|---|---|
| MySQL 9.6 на dev vs MariaDB 10.11 на prod расходятся | Используем только базовый SQL (Drizzle генерирует совместимый). При первом деплое — проверка миграции на staging. |
| argon2 нативный binding не собирается на Windows | Если упадёт — fallback на bcrypt (npm `bcrypt` тоже работает). Документируем процесс. |
| Cookie не пересылаются через туннель | Vite proxy сохраняет cookie, devtunnel прозрачен для HTTP. Проверяем smoke-тестом. |
| Refresh теряет auth-state | `AuthProvider.useEffect` делает GET /me на маунте — восстанавливаем. Покрыто acceptance criteria. |
| Drizzle migrations не работают с MySQL 9.6 | Drizzle поддерживает MySQL 8+. 9.6 не должен ломаться. Если есть проблемы — `db:push` (без миграций) как fallback в dev. |
| ESLint boundaries на server отсутствуют | В этой спеке — НЕ добавляем (server новый, сначала структуру построим, потом ESLint накроем). Отдельная мини-задача. |
