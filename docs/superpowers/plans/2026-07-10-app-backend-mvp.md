# App Backend MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать сгенерированным проектам собственный backend (вход, пользователи, база, правила) через общий App Runtime + SQLite-файл на проект с квотой 100 МБ — без сторонних сервисов.

**Architecture:** Одна общая программа-рантайм у нас на сервере обслуживает все приложения; каждый проект = один SQLite-файл (`apps-data/<project_id>.sqlite`) с системными таблицами (`_users`, `_sessions`) + таблицами приложения. Реестр приложений — в основной MariaDB. Фронт (статика на `<slug>.projectsflow.ru`) ходит в `<slug>.projectsflow.ru/api/*`. Спек: `docs/superpowers/specs/2026-07-10-app-backend-multitenant-design.md`.

**Tech Stack:** Node 22 LTS, ESM, TypeScript, Express 4, Drizzle+mysql2 (реестр), **better-sqlite3** (per-project БД, новая зависимость), `node:test`, jsonwebtoken + argon2 (auth энд-юзеров).

## Global Constraints

- Clean Architecture: `domain` (0 deps) ← `application` (порты+юзкейсы) ← `infrastructure` (адаптеры) ← `presentation` (HTTP). Импорты защищены eslint-boundaries.
- Тесты — `node:test` (НЕ vitest): `node --import tsx --test <file>`.
- Миграции — append-only, новый файл `db/NNN_*.sql`, MariaDB-совместимо (`VALUES(col)`, не `AS new`).
- Пользовательские строки — русский; код/типы/комменты — английский.
- Изоляция арендатора КРИТИЧНА: любой запрос строго к файлу своего `project_id`; пути из валидированного id, не из ввода. Только параметризованные SQL; имена таблиц/полей — из белого списка схемы.
- Квота по умолчанию 100 МБ (`104857600`), настраиваемая на проект.
- Новая зависимость `better-sqlite3` ставится в `server` workspace.

---

### Task 1: Реестр приложений — миграция + domain + repository

**Files:**
- Create: `db/054_app_backends.sql` *(следующий свободный номер — проверить фактический)*
- Create: `server/src/domain/app-backend/AppBackend.ts`
- Create: `server/src/domain/app-backend/errors.ts`
- Create: `server/src/application/app-backend/AppBackendRepository.ts` (порт)
- Modify: `server/src/infrastructure/db/schema.ts` (добавить `appBackends`)
- Create: `server/src/infrastructure/repositories/DrizzleAppBackendRepository.ts`
- Test: `server/src/infrastructure/repositories/DrizzleAppBackendRepository.test.ts` *(или юзкейс-тест на моке порта в Task 4)*

**Interfaces:**
- Produces: `AppBackend { projectId, status: 'none'|'active', schemaJson: AppSchema|null, appKeyHash: string|null, usageBytes: number, storageLimitBytes: number, createdAt, updatedAt }`; `AppBackendRepository { getByProject(id), upsert(input), setStatus, setUsage(id, bytes) }`.

**Steps:**
- [ ] Миграция `app_backends` (см. спек §4): PK `project_id CHAR(36)`, `status ENUM`, `schema_json MEDIUMTEXT NULL`, `app_key_hash VARCHAR(255) NULL`, `usage_bytes BIGINT DEFAULT 0`, `storage_limit_bytes BIGINT DEFAULT 104857600`, timestamps. Без схемного FK (как db/098 — collation errno 150), каскад чистим вручную.
- [ ] `domain/app-backend/AppBackend.ts` — типы + `DEFAULT_STORAGE_LIMIT = 100*1024*1024`.
- [ ] `domain/app-backend/errors.ts` — `AppBackendNotProvisionedError`, `StorageQuotaExceededError`, `AppSchemaInvalidError`, `AppUserExistsError`, `AppAuthError`, `AppTableNotAllowedError`.
- [ ] `application/.../AppBackendRepository.ts` — порт.
- [ ] schema.ts + DrizzleAppBackendRepository (`parseJsonCol` для schema_json, BIGINT→Number).
- [ ] Тест репозитория (или отложить на юзкейс-тесты). Commit.

### Task 2: Схема приложения + валидатор

**Files:**
- Create: `server/src/domain/app-backend/AppSchema.ts`
- Create: `server/src/application/app-backend/validateAppSchema.ts`
- Test: `server/src/application/app-backend/validateAppSchema.test.ts`

**Interfaces:**
- Produces: `AppSchema { tables: AppTable[] }`; `AppTable { name, fields: AppField[], rules: { read: Access, write: Access } }`; `AppField { name, type: 'text'|'int'|'real'|'bool'|'datetime', required?, unique? }`; `Access = 'anyone'|'authenticated'|'owner'`. `validateAppSchema(raw: unknown): AppSchema` (throws `AppSchemaInvalidError`).

**Steps (TDD):**
- [ ] Тест: валидная схема проходит; невалидная (плохое имя таблицы/поля — не `^[a-z][a-z0-9_]*$`, зарезервированные `_users/_sessions/_meta`, неизвестный type, дубли, отсутствие rules) → `AppSchemaInvalidError`.
- [ ] Реализация валидатора (белый список типов, regex имён, запрет `_`-префикса для пользовательских таблиц). Прогон. Commit.

### Task 3: SqliteAppDatabaseStore (per-project БД)

**Files:**
- Create: `server/src/application/app-backend/AppDatabaseStore.ts` (порт)
- Create: `server/src/infrastructure/app-backend/SqliteAppDatabaseStore.ts`
- Modify: `server/package.json` (добавить `better-sqlite3`)
- Test: `server/src/infrastructure/app-backend/SqliteAppDatabaseStore.test.ts`

**Interfaces:**
- Produces: `AppDatabaseStore { ensureDatabase(projectId, schema): void; sizeBytes(projectId): number; query(projectId, op): QueryResult; ... }` — где `op` — типизированные select/insert/update/delete + auth-таблицы. Внутренний открыватель файла по `baseDir/<projectId>.sqlite` с path-guard.

**Steps (TDD):**
- [ ] `AppDatabaseStore` порт.
- [ ] Тест: `ensureDatabase` создаёт файл + системные таблицы (`_users`,`_sessions`,`_meta`) + таблицы схемы; повторный вызов идемпотентен; `sizeBytes` растёт после вставок; path-traversal в projectId отвергается.
- [ ] Реализация на better-sqlite3: открытие/кэш соединений, применение схемы (CREATE TABLE IF NOT EXISTS с маппингом типов), параметризованные CRUD, `PRAGMA page_count*page_size` для размера. Прогон. Commit.

### Task 4: ProvisionAppBackend (юзкейс «завести бэкенд проекту»)

**Files:**
- Create: `server/src/application/app-backend/ProvisionAppBackend.ts`
- Test: `server/src/application/app-backend/ProvisionAppBackend.test.ts`

**Interfaces:**
- Consumes: `AppBackendRepository`, `AppDatabaseStore`, `validateAppSchema`, idGen, keyGen.
- Produces: `execute({ projectId, callerUserId, rawSchema }): { appKey }` — owner-only (`requireProjectAccess 'manage_app_repo'`); валидирует схему, `ensureDatabase`, генерит app-ключ (возвращает раз, хранит хеш), `status='active'`. Идемпотентно (повторный вызов обновляет схему).

**Steps (TDD):**
- [ ] Тест: owner+валидная схема → создаёт БД, апсертит реестр (status active, schema, keyHash), возвращает appKey; невалидная схема → ошибка; не-owner → InsufficientProjectRoleError.
- [ ] Реализация. Прогон. Commit.

### Task 5: Auth энд-юзеров приложения

**Files:**
- Create: `server/src/application/app-backend/AppAuthService.ts`
- Modify: `server/package.json` (`argon2`, `jsonwebtoken` — если ещё нет)
- Test: `server/src/application/app-backend/AppAuthService.test.ts`

**Interfaces:**
- Produces: `signUp(projectId, email, password): { user, token }`; `signIn(...): { user, token }`; `verify(projectId, token): AppUser|null`. Пароли — argon2; JWT подписан per-app секретом (из app_key или отдельного секрета в `_meta`).

**Steps (TDD):**
- [ ] Тест: signUp создаёт `_users` строку (хеш, не плейн); повторный email → `AppUserExistsError`; signIn верным паролем → токен; неверным → `AppAuthError`; verify(token) → user; чужой/битый токен → null.
- [ ] Реализация (через AppDatabaseStore для `_users`/`_sessions`). Прогон. Commit.

### Task 6: RunAppQuery (data-API: CRUD + правила + квота)

**Files:**
- Create: `server/src/application/app-backend/CheckQuota.ts`
- Create: `server/src/application/app-backend/RunAppQuery.ts`
- Test: `server/src/application/app-backend/RunAppQuery.test.ts`

**Interfaces:**
- Produces: `RunAppQuery.execute({ projectId, table, op: 'select'|'insert'|'update'|'delete', filter?, sort?, limit?, values?, currentUser? }): QueryResult`. Проверяет: таблица в схеме (иначе `AppTableNotAllowedError`); правило доступа (read/write vs currentUser); для write — квоту (`StorageQuotaExceededError` при ≥ limit); `owner`-правило по колонке `owner_id = currentUser.id`.

**Steps (TDD):**
- [ ] Тест: select с `read:anyone` без токена → ок; write с `write:owner` без токена → отказ; insert проставляет `owner_id`; фильтр/сортировка/лимит работают; таблица не из схемы → отказ; при usage ≥ limit — insert/update → `StorageQuotaExceededError`, select работает.
- [ ] Реализация (CheckQuota через `sizeBytes` vs `storageLimitBytes`; RunAppQuery через AppDatabaseStore, параметризованно). После записи — обновить `usage_bytes` в реестре. Прогон. Commit.

### Task 7: App Runtime — HTTP-роуты + монтирование

**Files:**
- Create: `server/src/presentation/app-runtime/routes.ts`
- Create: `server/src/presentation/app-runtime/resolveAppProject.ts` (по hostname → projectId через site/registry)
- Modify: `server/src/presentation/http.ts` (в host-middleware для app/board-поддоменов маршрутизировать `/api/*` в App Runtime ДО SPA-fallback)
- Modify: `server/src/index.ts` (wiring)
- Test: `server/src/presentation/app-runtime/routes.test.ts` (supertest-стиль на in-memory сторах) *(или ручная проверка)*

**Interfaces:**
- Routes: `POST /api/auth/signup|signin|signout`, `GET /api/auth/me`, `GET /api/data/:table`, `POST /api/data/:table`, `PATCH/DELETE /api/data/:table/:id`. Проект резолвится из поддомена (`resolveAppProject`), НЕ из тела.

**Steps:**
- [ ] `resolveAppProject` (hostname → projectId; переиспользовать логику slug→project из site-модуля).
- [ ] routes.ts (тонкие хендлеры → юзкейсы; ошибки → корректные HTTP: 401/403/409/413/400).
- [ ] Врезка в http.ts: на поддомене, ДО отдачи статики/SPA, `if req.path startsWith '/api/'` → appRuntimeRouter. Гейт: только если у проекта `app_backends.status='active'`.
- [ ] Wiring в index.ts. Прогон/ручная проверка. Commit.

### Task 8: JS-SDK для фронта

**Files:**
- Create: `packages/app-client/` (или `client-sdk/`) — `index.ts`: `createClient(apiBase, appKey)` → `{ auth: { signUp, signIn, signOut, user() }, from(table) }`.
- Test: `packages/app-client/index.test.ts` (моки fetch).

**Steps (TDD):**
- [ ] Тест: `from('posts').select({filter})` шлёт правильный GET; `insert` — POST с токеном из auth; ошибки маппятся.
- [ ] Реализация (тонкая обёртка над fetch, хранит токен). Сборка. Commit.

### Task 9: Провижининг воркером + UI-тумблер (интеграция self-serve)

**Files:**
- Create: MCP-tool `pf_declare_app_schema` в `mcp-server/` (воркер объявляет схему → зовёт ProvisionAppBackend через agent-эндпоинт).
- Create: agent-эндпоинт `POST /api/agent/projects/:id/app-backend` (Bearer, requireDispatcherAccess) → ProvisionAppBackend.
- Modify: client — тумблер/тип «app с бэкендом» + показ «usage X/100 МБ» (новый юзкейс `getAppBackendStatus`).
- Test: соответствующие юзкейс/роут тесты.

**Steps:**
- [ ] Agent-эндпоинт провижининга + MCP-tool.
- [ ] Клиентский индикатор usage + тумблер.
- [ ] Документация в spec «как воркер объявляет схему» (формат `projectsflow.app.json`). Прогон. Commit.

---

## Self-Review

- **Покрытие спека:** §4 реестр → T1; §5 auth → T5; §6 data-API → T6; §7 квота → T6/CheckQuota; §8 изоляция → T3 path-guard + T6 whitelist; §9 провижининг → T4/T9; §10 слои → все; §3 SDK → T8. Ок.
- **Плейсхолдеры:** номер миграции (`054`) — проверить фактический свободный при старте T1. Пути пакета SDK (`packages/` vs `client-sdk/`) — уточнить структуру монорепо при старте T8.
- **Типы:** `AppSchema`/`Access`/`AppUser` определены в T2/T5 и переиспользуются в T3/T6 консистентно.
- **Порядок:** T1→T2→T3 (стор зависит от схемы) →T4 (провижининг зависит от стора+валидатора) →T5,T6 (зависят от стора) →T7 (роуты зависят от юзкейсов) →T8 (SDK, независим) →T9 (интеграция). Ок.

**Порядок исполнения:** MVP = T1–T7 (рабочий backend с auth+data+квотой). T8–T9 — «под ключ» self-serve поверх MVP.
