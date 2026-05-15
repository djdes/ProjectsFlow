# Spec #5: Knowledge Base architecture

**Дата:** 2026-05-15
**Статус:** Утверждён (брейншторм)
**Зависит от:** [Spec #3 (auth + backend)](2026-05-14-backend-auth-design.md), [Spec #4 (project creation)](2026-05-14-project-creation-design.md), GitHub OAuth integration (текущая).

---

## 1. Контекст и scope

### Цель

Дать каждому проекту собственную **knowledge base**: структурированные markdown-файлы в выделенном GitHub-репо. ИИ-ассистенты (главным образом Claude Code) пишут туда контекст: креды, ADR'ы, runbooks, заметки. Пользователь в web-UI просматривает и редактирует это через формы; видит секреты, скрытые за криптографией.

### Закрытые решения (брейншторм 2026-05-14/15)

| # | Вопрос | Решение |
|---|---|---|
| 1 | Storage backend | **GitHub юзера** (KB-репо в его аккаунте, через уже подключённый OAuth-токен). |
| 2 | Strictness frontmatter | **L1 minimum**: `type`+`title` везде, `secret_ref` для `type: credential`. Остальное — конвенция, не enforced. |
| 3 | MCP server | **Не делаем** в этой спеке. Внешний AI-доступ — через Claude.ai GitHub-коннектор или git clone. |
| 4 | Secrets storage | **B-simple**: AES-256-GCM, master key в `.env`, secrets в отдельной таблице БД. |
| 5 | Migration | **Additive**: + колонка `projects.kb_repo_full_name`, + таблица `secrets`. Существующие данные не трогаем. |

### Что ВНУТРИ scope

- DB: миграция (+`kb_repo_full_name`, новая таблица `secrets`).
- GitHub-flow: создать новый репо `<slug>-kb` или подключить существующий.
- Backend: read/write через GitHub Contents API; frontmatter-валидатор; AES-GCM helper для секретов.
- UI на странице проекта: вкладка «KB» — дерево папок, content viewer, формы для типизированных файлов, secret reveal.
- Meilisearch как поисковой индекс (отдельный sidecar-сервис).
- Папочные конвенции и шаблоны на init: `credentials/`, `decisions/`, `services/`, `schemas/`, `runbooks/`, `notes/`.

### Что СНАРУЖИ scope

| Тема | Когда |
|---|---|
| MCP-сервер | Когда возникнет конкретная необходимость подключить внешний AI |
| Zero-knowledge crypto для секретов | Когда серьёзно пойдём в multi-tenant prod |
| GitLab/Bitbucket поддержка | Когда появится первый юзер вне GitHub |
| Pre-push валидация (block на write) | Невозможно без своего git-сервера; см. секцию «Валидация и push» |
| Графы связей между документами | Будущая фича |
| Версионирование секретов | Версий нет — последнее значение wins, encrypted_at_rest |
| Тесты на drizzle-миграции | После Spec #2 backend (отложено как и раньше) |

---

## 2. БД-миграция (additive)

Drizzle schema → push:

```ts
// server/src/infrastructure/db/schema.ts (additions)

export const projects = mysqlTable('projects', {
  // ...existing columns
  kbRepoFullName: varchar('kb_repo_full_name', { length: 255 }),
  // null = KB не подключён к этому проекту
});

export const secrets = mysqlTable('secrets', {
  id: char('id', { length: 36 }).primaryKey(),
  userId: char('user_id', { length: 36 }).notNull(),  // FK→users.id, CASCADE
  // Логический ключ. Формат: project-slug/credential-file/field-name
  // Например: "scanflow/prod-db/password"
  secretKey: varchar('secret_key', { length: 500 }).notNull(),
  // base64(iv || ciphertext || authTag). AES-256-GCM.
  encrypted: varchar('encrypted', { length: 2000 }).notNull(),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: updatedAtCol(),
}, (t) => [
  uniqueIndex('uq_secrets_user_key').on(t.userId, t.secretKey),
  index('idx_secrets_user').on(t.userId),
]);
```

`secrets.secretKey` — это значение, которое юзер положит в frontmatter как `secret_ref: vault://<project-slug>/<credential-file>/<field>`. Парсинг и валидация формата — на backend.

---

## 3. KB-репо: создание и привязка

### 3.1 UI на странице проекта

Под секцией «GitHub репозиторий» появляется новая секция — **«База знаний (KB)»**:

- **Состояние «KB не подключён»** — две кнопки:
  - «Создать KB-репо» (по умолчанию) → создаст новый приватный репо `<project-slug>-kb` в личном GitHub юзера.
  - «Подключить существующий» → открывает picker (тот же что и для code-репо).
- **Состояние «KB подключён»** — показывает `owner/repo`, кнопку «Открыть KB» (переход на `/projects/<id>/kb`), «Отключить KB».

### 3.2 Backend: создание нового KB-репо

`POST /api/projects/:id/kb/init`:
1. Берём `project` (scoped по owner).
2. Берём `user_github_token` юзера.
3. GitHub API: `POST /user/repos` с `name=<project-slug>-kb`, `private=true`, `description=ProjectsFlow KB for <project.name>`, `auto_init=true`.
4. Создаём 7 файлов через `PUT /repos/{full_name}/contents/{path}`:
   - `README.md` — описание структуры
   - `credentials/.gitkeep`, `decisions/.gitkeep`, `services/.gitkeep`, `schemas/.gitkeep`, `runbooks/.gitkeep`, `notes/.gitkeep`
5. Записываем `projects.kb_repo_full_name = "<owner>/<name>"`.
6. Возвращаем обновлённый project.

### 3.3 Backend: подключение существующего

`POST /api/projects/:id/kb/connect` body `{ fullName: "owner/repo" }`:
1. Валидируем что юзер имеет доступ к репо (`GET /repos/{full_name}` от его имени → 200).
2. Записываем `kb_repo_full_name`. Папки НЕ создаём — юзер может уже иметь свою структуру.

### 3.4 Backend: отключение

`DELETE /api/projects/:id/kb`:
- Только обнуляет `kb_repo_full_name`. Репо в GitHub не трогаем — он принадлежит юзеру.

---

## 4. Folder conventions

```
<project-slug>-kb/
├── README.md
├── credentials/    type: credential — креды, явно требуют secret_ref
├── decisions/      type: decision — ADR
├── services/       type: service — компоненты системы
├── schemas/        type: schema — диаграммы, ER, mermaid
├── runbooks/       type: runbook — операционные процедуры
└── notes/          type: note — свободная форма
```

Файлы — `*.md` с YAML-frontmatter в начале (между `---`).

Минимальная валидация (L1) на **server-side write через UI**:

| `type` | Required fields | Дополнительная проверка |
|---|---|---|
| Все | `type`, `title` | — |
| `credential` | + **минимум одно поле с именем `*_ref`** (например `password_ref`, `token_ref`, `secret_ref`) с форматом `vault://<project-slug>/<file-slug>/<field>` | Голый password/token в body или frontmatter → REJECT |
| `decision`, `service`, `schema`, `runbook`, `note` | — | — |

Дополнительные поля (`kind`, `service`, `host`, `status`, и т.д.) разрешены, не обязательны. Шаблоны при инициализации содержат пример.

---

## 5. Валидация и push

### Через UI (write-through ProjectsFlow)

- Юзер редактирует файл в нашем UI → submit.
- Backend парсит YAML, проверяет required fields (см. §4), если `type=credential` — сканирует body на «голые» секреты (regex для `password:`, `token:`, hex/base64 ≥32 символов).
- Если invalid → 422 с массивом ошибок, показываем в форме.
- Если ok → `PUT /repos/{full_name}/contents/{path}` с base64(новое содержимое), commit message `chore(kb): update <path> via ProjectsFlow UI`.

### Через git push / Claude Code локально

- Юзер делает `git clone`, правит, `git push` — наш validator ОБОЙДЁН (мы не git-сервер).
- Это **сознательное ограничение** GitHub-storage модели (см. Q1 в брейншторме).
- Сглаживаем:
  - При первом push после connect — Webhook `push` от GitHub в `/api/integrations/github/webhook/kb` → backend перечитывает изменённые файлы → валидирует → выставляет `kb_validation_status` для каждого файла в Meilisearch-индексе.
  - В UI на проблемных файлах показываем красный бейдж «Frontmatter invalid: <причина>». Юзер видит, идёт чинить.

### Опционально (вне scope этой спеки)

GitHub Action в KB-репо при init, которая на CI валидирует frontmatter и фейлит build при invalid. Дополнительный slack-стайл feedback в GitHub PR UI. Реализация — отдельной спекой.

---

## 6. Secrets handling (B-simple)

### 6.1 Криптография

`server/src/infrastructure/crypto/SecretCipher.ts`:

- Алгоритм: **AES-256-GCM** (Node `crypto.createCipheriv('aes-256-gcm', key, iv)`).
- Key: 32 байта, читается из `process.env.SECRETS_MASTER_KEY` (base64). Генерится при первом запуске setup-скрипта, кладётся в `.env`. Один на инстанс ProjectsFlow.
- IV: 12 байт случайных на каждое шифрование.
- Format: `base64(iv || ciphertext || authTag)` → одна строка в БД.
- Decrypt: проверяет authTag, бросает ошибку при tamper.

### 6.2 Поток записи

`PUT /api/secrets` body `{ key: "scanflow/prod-db/password", value: "..." }`:
1. Валидация формата `key` (regex `^[a-z0-9-]+/[a-z0-9-]+/[a-z0-9_]+$`).
2. `encrypt(value)` → base64.
3. Upsert в `secrets` (unique по `(userId, secretKey)`).
4. Возвращаем 204 No Content (не возвращаем value обратно).

### 6.3 Поток чтения

`GET /api/secrets?key=scanflow/prod-db/password`:
1. Find by `(userId, secretKey)`.
2. `decrypt(encrypted)` → plain.
3. Возвращаем `{ value: "..." }`.
4. **Логируем reveal-action** (server-side info-лог, не в БД пока).

В UI: кнопка-глаз рядом с полем, на клик дёргает endpoint, показывает значение. Дополнительно кнопка «Copy».

### 6.4 Удаление и список

- `DELETE /api/secrets?key=...` — по ключу.
- `GET /api/secrets/list` — только список ключей (БЕЗ значений), для админ-UI «все мои секреты».

### 6.5 Связь с frontmatter

В файле `credentials/prod-db.md`:

```yaml
---
type: credential
title: Production MySQL
kind: mysql
host: 10.0.0.5
user: app
password_ref: vault://scanflow/prod-db/password
---

Доступен только из private subnet.
```

`password_ref` (или любое `_ref`-поле) — это «ссылка». Когда UI рендерит форму редактирования, поля с суффиксом `_ref` отображаются как «секретное поле» с input-password + reveal-кнопкой. При сохранении формы:
- Если значение не менялось — оставляем `_ref` как есть.
- Если ввели новое значение — `PUT /api/secrets` с тем же key, frontmatter не меняется (ссылка та же).
- Если очистили поле — `DELETE /api/secrets`.

---

## 7. Web UI

Новый раздел в правой панели страницы проекта — таб «KB» (или новая страница `/projects/<id>/kb`).

### 7.1 Дерево файлов

Слева — collapsible-дерево с папками-conventions. Только файлы из этих папок отображаются «по правилам»; остальные (если юзер сам положил) — как «notes/uncategorized». Иконки по типу.

### 7.2 Просмотр файла

При клике — справа:
- Frontmatter table (parsed YAML → ключ/значение, с подсветкой `_ref`-полей).
- Body — markdown-render через `react-markdown` + `remark-gfm` (mermaid через `react-mermaid2` опционально).
- Кнопки «Редактировать», «Открыть на GitHub».

### 7.3 Редактирование

**Для типизированных** (credential/decision/service/schema/runbook) — структурированная форма:
- Поля frontmatter — отдельные inputs.
- Body — markdown-textarea (без realtime preview, чтобы не тяжелить — preview по табу).
- Submit → server валидирует → write в GitHub.

**Для note** — просто markdown-textarea без полей.

### 7.4 Создание нового

«+ Новый файл» в каждой папке. Открывает форму, заполненную из шаблона. После сохранения — файл в GitHub + перенаправление на просмотр.

### 7.5 Поиск

Глобальный search в UI KB → Meilisearch-индекс с фильтрами `userId === currentUser.id` AND `projectId === currentProject.id`. Это эквивалентно «искать в этом KB-репо» (фильтр по userId — для security, по projectId — для скоупа).

---

## 8. Meilisearch

Отдельный sidecar-сервис (Docker позже, пока — локальный binary рядом). При connect KB или push в репо — ProjectsFlow:
1. Перечитывает все файлы из репо через GitHub Contents API.
2. Парсит frontmatter + body.
3. Индексирует `{ id: <full_name>/<path>, userId, projectId, type, title, body, path, lastModified, validationErrors? }`.

Index name: `kb_documents`. Filterable attributes: `userId`, `projectId`, `type`. Searchable: `title`, `body`.

При запросе поиска — фильтр по `userId === currentUser.id` (security) + `projectId` если scoped.

### Configuration

- `MEILISEARCH_URL` в `.env` (default `http://localhost:7700`).
- `MEILISEARCH_MASTER_KEY` в `.env`.
- Init Meilisearch index при старте сервера если отсутствует.

### Если Meilisearch недоступен

UI работает (read/edit через GitHub API напрямую). Поиск disabled с тостом «Search недоступен, перезапусти Meilisearch». Это не блокер.

---

## 9. Архитектура (Clean Arch, server-side)

```
server/src/
├── domain/
│   └── kb/
│       ├── KbDocument.ts          { path, type, title, frontmatter, body, validationErrors }
│       ├── KbFolder.ts            convention type
│       ├── Frontmatter.ts         parsed YAML
│       └── errors.ts              FrontmatterInvalidError, KbNotConnectedError, SecretKeyInvalidError, ...
├── application/
│   ├── kb/
│   │   ├── KbRepository.ts        port: list/get/write/delete files in remote KB-repo
│   │   ├── KbIndexer.ts           port: index file → Meilisearch
│   │   ├── FrontmatterValidator.ts pure: validates + extracts secrets
│   │   ├── InitKbRepo.ts          use-case: create repo + folders
│   │   ├── ConnectKbRepo.ts       use-case: bind existing
│   │   ├── ListKbDocuments.ts
│   │   ├── GetKbDocument.ts
│   │   ├── WriteKbDocument.ts     orchestrates validate → GitHub PUT → indexer
│   │   └── SearchKb.ts
│   └── secrets/
│       ├── SecretsRepository.ts   port: encrypt/store/decrypt/delete
│       ├── PutSecret.ts
│       ├── GetSecret.ts
│       └── DeleteSecret.ts
├── infrastructure/
│   ├── kb/
│   │   ├── GithubKbRepository.ts  uses existing FetchGithubApiClient
│   │   └── MeilisearchIndexer.ts
│   ├── crypto/
│   │   ├── Argon2PasswordHasher.ts   (existing)
│   │   └── AesGcmSecretCipher.ts     NEW
│   └── repositories/
│       └── DrizzleSecretsRepository.ts
└── presentation/
    ├── kb/
    │   ├── routes.ts              /api/projects/:id/kb/*
    │   ├── schemas.ts             zod
    │   └── webhook.ts             /api/integrations/github/webhook/kb
    └── secrets/
        ├── routes.ts              /api/secrets
        └── schemas.ts
```

Слой `presentation/kb` не лезет в GitHub напрямую — через use-cases. Это же касается секретов.

### Client-side

```
client/src/
├── domain/kb/
│   ├── KbDocument.ts
│   └── ...
├── application/kb/
│   ├── KbRepository.ts            port
│   └── use-cases (вызовы по API)
├── infrastructure/http/
│   ├── HttpKbRepository.ts
│   └── HttpSecretsRepository.ts
└── presentation/
    ├── pages/KbPage.tsx
    ├── components/kb/
    │   ├── KbFileTree.tsx
    │   ├── KbDocumentViewer.tsx
    │   ├── KbDocumentEditor.tsx
    │   ├── KbSearchBar.tsx
    │   └── SecretField.tsx       reveal/copy/edit для _ref-полей
    └── hooks/useKbDocument.ts
```

---

## 10. Endpoints summary

| Method | Path | Назначение |
|---|---|---|
| POST | `/api/projects/:id/kb/init` | Создать новый KB-репо |
| POST | `/api/projects/:id/kb/connect` | Подключить существующий (`{fullName}`) |
| DELETE | `/api/projects/:id/kb` | Отключить (только обнуление `kb_repo_full_name`) |
| GET | `/api/projects/:id/kb/tree` | Дерево файлов из репо |
| GET | `/api/projects/:id/kb/documents/*` | Содержимое файла (`*` = path) |
| PUT | `/api/projects/:id/kb/documents/*` | Запись/создание (валидация + GitHub PUT) |
| DELETE | `/api/projects/:id/kb/documents/*` | Удаление |
| GET | `/api/projects/:id/kb/search?q=...` | Meilisearch query |
| POST | `/api/integrations/github/webhook/kb` | GitHub push webhook → reindex |
| PUT | `/api/secrets` | Записать секрет (`{key, value}`) |
| GET | `/api/secrets?key=...` | Прочитать значение |
| DELETE | `/api/secrets?key=...` | Удалить |
| GET | `/api/secrets/list` | Список ключей юзера (без значений) |

Все scoped по `req.user.id`. KB-эндпоинты дополнительно требуют ownership проекта.

---

## 11. Конфигурация

`.env` добавляет:

```
# AES-256-GCM key для секретов (32 байта, base64-encoded). Сгенерировать:
# node -e "console.log(crypto.randomBytes(32).toString('base64'))"
SECRETS_MASTER_KEY=

# Meilisearch sidecar
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_MASTER_KEY=

# Webhook secret для проверки подписи GitHub
GITHUB_WEBHOOK_SECRET=
```

`.env.example` обновляется параллельно.

---

## 12. Acceptance criteria

### DB / Infra
- [ ] Drizzle push добавил колонку `projects.kb_repo_full_name` и таблицу `secrets`.
- [ ] Существующие данные не повреждены.
- [ ] Meilisearch локально поднят и доступен по `MEILISEARCH_URL`.

### KB repo lifecycle
- [ ] Кнопка «Создать KB-репо» создаёт новый private-репо в GitHub юзера, имя `<slug>-kb`, с 6 папками и README.
- [ ] Кнопка «Подключить существующий» сохраняет `kb_repo_full_name` после проверки доступа.
- [ ] Кнопка «Отключить KB» обнуляет колонку, репо в GitHub НЕ удаляется.

### Read / write
- [ ] `/projects/:id/kb` показывает дерево с 6 conv-папками + другими (если есть).
- [ ] Клик на файл — рендерит markdown + frontmatter-таблицу.
- [ ] Создание/редактирование типизированного файла через форму валидируется на server (L1 правила).
- [ ] Голый секрет (regex match `password:`/`token:` + ≥32-символьный hex/base64) в credential → 422.
- [ ] Успешный write делает commit в GitHub с message `chore(kb): ...`.

### Secrets
- [ ] Поле `*_ref: vault://...` в форме отображается как password-input + reveal/copy.
- [ ] Reveal делает `GET /api/secrets` и показывает plain value.
- [ ] Запись через форму делает `PUT /api/secrets`, в БД лежит зашифрованное.
- [ ] AES-GCM authTag проверяется при decrypt — tampered cipher даёт 500 + лог.
- [ ] Без `SECRETS_MASTER_KEY` в env — сервер стартует с warning, secrets endpoints отдают 503.

### Search
- [ ] Поиск находит документ по title/body, фильтр по userId/projectId работает.
- [ ] Webhook от GitHub переиндексирует затронутые файлы.
- [ ] Если Meilisearch недоступен — UI search disabled, остальное работает.

### Architecture
- [ ] Clean-arch боундери: `presentation/kb/*` не импортирует `infrastructure/*`. ESLint зелёный.
- [ ] Frontmatter-валидатор живёт в `application/kb/FrontmatterValidator.ts`, чистая функция без deps.
- [ ] `AesGcmSecretCipher` реализует port `SecretsCipher` из application.

---

## 13. Открытые вопросы (решить на этапе writing-plans)

1. **Markdown render**: `react-markdown` + `remark-gfm` или что-то с поддержкой mermaid из коробки (`@uiw/react-md-editor`)? — выбрать по объёму зависимостей.
2. **File-path с slash в URL**: использовать `*` (Express wildcard) или `encodeURIComponent`? Wildcard проще.
3. **Frontmatter parser**: `js-yaml` (надёжный, ~30 KB) или `gray-matter` (markdown-specific wrapper)? Выбрать на write-up плана.
4. **Webhook signature verification**: реализовать HMAC-SHA256 (`X-Hub-Signature-256`) или пропустить и полагаться на secret-в-URL? Реализовать.
5. **Шаблоны файлов при init**: где хранить? `server/templates/kb/*.md` — readable + быстро править.

---

## 14. Риски

| Риск | Митигация |
|---|---|
| GitHub API rate limit (5000/hr authenticated) | Caching через Meilisearch как «cold cache». Heavy reads не идут в GitHub. |
| Юзер удалил KB-репо в GitHub руками | Backend detects 404 → показывает «KB-репо больше не доступен» + кнопка «Reconnect or Create new». |
| Юзер отозвал GitHub-токен (см. existing flow) | Всё KB перестаёт работать. Сообщаем в UI «Восстанови подключение GitHub в /profile». |
| `SECRETS_MASTER_KEY` потерян/изменён | Все секреты в БД становятся unreadable. На старте сервер делает проверку «один из тестовых секретов decryptable» и фейлит, если нет. Юзер пересоздаёт секреты. |
| Push через CLI с битым frontmatter | См. §5 — валидация на read, UI показывает invalid-status. Не блокируем push. |
| Race condition: одновременный push через git и через UI | GitHub отдаёт `409 Conflict` если SHA устарел. UI говорит «изменения в репо устарели, обнови». |
| Meilisearch downtime | Search disabled, остальное продолжает работать. |
| Большое body файла (>1 MB) | GitHub Contents API имеет лимит ~1 MB. Запрет write если превышен. Meilisearch индексирует только первые ~10 KB. |
