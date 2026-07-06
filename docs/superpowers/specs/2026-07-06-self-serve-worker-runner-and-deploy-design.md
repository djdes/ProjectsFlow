# Spec: self-serve воркер-раннер + деплой результата

- **Дата:** 2026-07-06
- **Статус:** дизайн утверждён на уровне архитектуры, детализируется
- **Тема:** дать self-serve юзеру реально исполняемого воркера — агент собирает проект в GitHub
  Actions, код едет в его GitHub-репо, статический результат деплоится на `<slug>.projectsflow.ru`
- **Это под-проект 1** из большого замысла (см. «Декомпозиция» ниже). Публичный канбан/плашка
  (сделано), реальные платежи, публичная страница результата — отдельные под-проекты.

## 1. Проблема

Сегодня воркер = человек с локальным `dispatch.ps1` + `claude -p`; кода на сервере нет,
исполнения нет. Для нового self-serve юзера, который пишет «сделай лендинг про обувь», **некому
и негде это выполнить**. Нужна исполняющая среда + хостинг результата, без человека-диспетчера и
без своего облачного раннера.

## 2. Архитектура (обновлено 2026-07-06 — диспетчер-модель)

> **Смена модели.** Anthropic API-ключа у платформы НЕТ, а «свой ключ» (BYOK) пока не делаем. Поэтому
> модель «GitHub Actions + наш ключ через прокси» отпадает (нечего проксировать). Вместо неё —
> **существующий диспетчер** (`dispatch.ps1`), который работает на **Claude-подписке** (не API-ключ!):
> человек/сервисный пул с Claude-подпиской забирает задачу по подписке юзера, собирает сайт и пушит в
> его GitHub-репо. Юзер про ключи не знает (у диспетчера своя Claude-подписка). Это переиспользует всю
> готовую dispatch-инфру (clone по делегированному токену, LIVE-лента, метеринг-гейт) и убирает нужду
> в Anthropic-ключе, GitHub Actions, OIDC и прокси.

```
Задача → колонка «Воркер» (todo)
   → диспетчер (dispatch.ps1, репо C:\www\ralph, Claude-подписка) поллит задачу по REST,
     проходит бюджет-гейт CheckDispatchAllowed (подписка юзера)
        ↓
На машине диспетчера:
   • clone app-репо ЮЗЕРА (делегированный GitHub-токен владельца, resolveEffectiveGithubToken)
   • claude -p (Claude Code, подписка диспетчера) выполняет задачу
   • стримит прогресс → LIVE-лента (готовые /api/agent/.../live эндпоинты)
   • коммитит + пушит в репо ЮЗЕРА
   • билдит статику (dist/) → POST dist/ на наш сервер (PublishSiteArtifact, авторизация agent-токеном)
   • финиш прогона → метеринг в подписку (RecordUsage)
        ↓
сервер: сохраняет ТОЛЬКО собранный сайт (не исходники)
        ↓
<slug>.projectsflow.ru отдаёт последний артефакт (host-роутинг в Express)
```

**Что в ЭТОМ репо (сервер) vs внешнем `C:\www\ralph`:** `dispatch.ps1` (clone/claude/push/build/upload) —
внешний репо, отдельная доработка (научить билдить статику + звать PublishSiteArtifact). В этом репо
(сервер) — модель прогона/артефакта, эндпоинт приёма dist, host-роутинг поддомена, назначение сервисного
диспетчера self-serve проектам.

**Юзер про ключи не знает:** у диспетчера — своя Claude-подписка; юзер платит платформенную подписку,
которая гейтит доступ (`free` не пускают) и метерится. **Форвард-совместимо:** если позже появится
Anthropic-ключ или BYOK — добавляется как альтернативный раннер, модель триггера/деплоя не меняется.

## 3. Ops-предусловия (часть владельца, разово — НЕ код)

Диспетчер-модель убирает Anthropic-ключ, GitHub-орг, PAT, OIDC, прокси. Остаётся:
1. **Запущенный диспетчер** (сервисный пул `dispatch.ps1` на Claude-подписке), назначенный
   self-serve проектам (`dispatcherUserId`). Существующая инфра.
2. **wildcard DNS** `*.projectsflow.ru` + **один** wildcard-vhost nginx (`*.projectsflow.ru` →
   Express `127.0.0.1:4317`) + **wildcard-TLS** (Let's Encrypt DNS-01). nginx правится один раз (админ).
3. `SITE_ARTIFACTS_DIR` — путь вне deploy-tarball (напр. `/var/www/.../site-artifacts`).
4. **GitHub OAuth Client ID** — уже есть (`GITHUB_CLIENT_ID`, device-flow); дополнительно ничего.

## 4. Слои / компоненты (Clean Arch)

### Домен
- `domain/worker-run/WorkerRun.ts` — прогон: `{ id, projectId, taskId, status: queued|running|
  succeeded|failed|timeout, siteSlug, commitSha?, costUsd?, tokensIn?/Out?, error?, createdAt,
  finishedAt }`.
- `domain/worker-run/SiteArtifact.ts` — метаданные задеплоенного сайта: `{ projectId, slug,
  lastRunId, publishedAt }`.
- `domain/project/appRepo.ts` — правило имени репо из slug'а проекта (реюз slugify из InitKbRepo),
  + функция `appSubdomainUrl(slug)` (единая сборка `https://<slug>.projectsflow.ru`).

### Application (порты + use-cases)
- `EnsureProjectAppRepo` — если у проекта нет app-репо: берёт токен владельца
  (`resolveEffectiveGithubToken`), создаёт репо (паттерн `InitKbRepo`/`createRepo`, 422→идемпотентно),
  пишет `projects.app_repo_full_name`. Требует привязанный GitHub (иначе `GithubNotConnectedError`).
  **Реализовано в M1.**
- `PublishSiteArtifact` — принимает загруженный `dist/` от диспетчера, кладёт в
  `SITE_ARTIFACTS_DIR/<slug>/` (атомарно: во временную папку → rename), обновляет
  `SiteArtifact.lastRunId/publishedAt`. Слаг сайта = `public_slug` проекта (реюз db/096).
- Исполнение задачи — **существующий диспетчер** (`dispatch.ps1`), НЕ отдельный use-case: он уже
  поллит todo-задачи, проходит `CheckDispatchAllowed`, открывает LIVE-сессию, метерит `RecordUsage`.
  Доработка диспетчера (билд статики + вызов PublishSiteArtifact) — во внешнем репо `C:\www\ralph`.
- (опц.) `AssignServiceDispatcher` — назначить сервисный пул диспетчером self-serve проекта при
  создании app-репо (чтобы задачи забирались без ручного назначения).
- Порты: `SiteArtifactRepository`, `SiteArtifactStorage`.

### Infrastructure
- `DrizzleSiteArtifactRepository`.
- `FileSystemSiteArtifactStorage` — по паттерну `FileSystemBlobStorage` (запись/чтение/список файлов
  сайта, path-traversal guard).

### Presentation
**Авторизованные** (под `/api/projects/:id`, owner/member):
- `GET .../site` → метаданные задеплоенного сайта (`{ slug, url, publishedAt }` или 404).

**Ingest от диспетчера** (под `/api/agent`, авторизация agent-токеном — как остальные `/agent/*`):
- `POST /api/agent/projects/:id/site-artifact` (multipart tar/zip) → `PublishSiteArtifact`.
  (LIVE/метеринг диспетчер уже шлёт в существующие `/api/agent/.../live` и usage-эндпоинты.)

**Host-роутинг (публичная отдача сайта):** middleware в `http.ts` **до** landing/SPA-статики:
если `req.hostname` = `<slug>.projectsflow.ru` (не корневой домен) → отдать
`SITE_ARTIFACTS_DIR/<slug>/` через `express.static`/`sendFile` (path-traversal guard как на
landing-роуте). Нет артефакта → аккуратная страница «сайт ещё собирается / не найден». Поддомен —
capability-URL «только у владельца» (несекретный slug, но не индексируем; при желании отдельный токен).

### Client
- Привязка GitHub — реюз существующего device-flow UI (если не привязан).
- **Липкое уведомление-гейт:** при попытке кинуть задачу в «Воркер» без привязанного GitHub — баннер
  «Привяжите GitHub, чтобы воркер заработал», не гаснет, пока (а) не привязал ИЛИ (б) не вытащил
  задачу из колонки. Состояние — пер-проект, реюз паттерна плашки/событий.
- Триггер прогона — перемещение задачи в колонку «Воркер» (todo) → `POST worker-runs` (гейт бюджета
  на клиенте показывает upgrade-диалог при `plan_required`/`budget_exceeded`).
- Кнопка/ссылка «Результат» → `<slug>.projectsflow.ru` (появляется, когда есть `SiteArtifact`).
- LIVE-лента прогона — та же вкладка, что уже есть.

## 5. Данные (миграции, append-only)

- `NNN_worker_runs.sql` — таблица `worker_runs` (см. домен). FK project/task.
- `NNN_site_artifacts.sql` — `site_artifacts` (project_id, slug UNIQUE, last_run_id, published_at).
- `NNN_project_app_repo.sql` — `projects.app_repo_full_name VARCHAR(255) NULL`.

## 6. Метеринг и оплата

- Метеринг переиспользует готовый движок: `FinishWorkerRun` → `RecordUsage(source='live'...)` в
  подписку инициатора; гейт `CheckDispatchAllowed` в `StartWorkerRun`.
- **Реальный платёж — отдельный под-проект.** На время раннер-MVP «активирована ли подписка»
  гейтим существующими механиками плана (prime/vip флаг, admin-grant, 1ч-триал). Реальный платёж
  (YooKassa/Stripe) прикрутим следующим под-проектом; `BuyPlan` станет «создать платёж → webhook →
  выдать план+expiry».

## 7. Тестирование

- **Домен/app (node:test + фейки):** имя репо из slug; `StartWorkerRun` гейтит бюджет и требует
  app-репо; `EnsureProjectAppRepo` идемпотентен на 422; `PublishSiteArtifact` атомарен; run-token
  подпись/верификация; `FinishWorkerRun` метерит.
- **Host-роутинг:** юнит на резолв `<slug>` из hostname + path-traversal guard.
- **Клиент:** typecheck/lint; визуальная проверка липкого гейта + ссылки на результат.
- **Ops-зависимые части (workflow ↔ прокси ↔ deploy)** проверяются только на реальном сетапе
  (Anthropic-ключ + DNS + реальный GitHub-аккаунт) — smoke-тест после провижининга; в этом
  окружении полностью не воспроизводимо.

## 8. Майлстоуны (порядок реализации)

- **M1 — GitHub-привязка + авто-репо + липкий гейт** (строится/тестится СЕЙЧАС, без ops):
  `EnsureProjectAppRepo`, `projects.app_repo_full_name`, device-flow-подключение в UI, липкое
  уведомление в колонке «Воркер». Deliverable: у проекта появляется app-репо в GitHub юзера +
  Реализовано (M1 ✅). Workflow-файл больше не нужен (не Actions-модель).
- **M2 — диспетчер собирает и пушит** (нужен запущенный диспетчер на Claude-подписке, назначенный
  проекту): доработка `dispatch.ps1` во внешнем репо `C:\www\ralph` — билд статики + вызов
  `POST /api/agent/projects/:id/site-artifact`. На стороне сервера — эндпоинт ingest артефакта.
  Deliverable: задача воркеру собирается диспетчером и пушится в репо юзера.
- **M3 — приём артефакта + host-роутинг деплоя** (нужны DNS+vhost+TLS+`SITE_ARTIFACTS_DIR`):
  `PublishSiteArtifact`, `SiteArtifact`, `FileSystemSiteArtifactStorage`, host-middleware. Deliverable:
  результат на `<slug>.projectsflow.ru`. (Серверную часть M3 можно строить параллельно с M2.)
- **M4 — отделка** (LIVE-лента прогона в UI, кнопка «Результат», upgrade-диалог по бюджет-гейту).

## 9. Вне scope (осознанно)

- Реальные платежи (отдельный под-проект).
- Динамика/бэкенд-приложения (Pages/статик-хостинг не потянет — только статический результат).
- Публичная страница результата с оформлением/превью в UI платформы (под-проект 4) — здесь только
  сам поддомен с сайтом.
- **BYOK / свой Claude — НЕ в этом spec** (пока нет и Anthropic-ключа у платформы). Задел: раннер
  абстрагирован от «кто исполняет» — сейчас диспетчер на Claude-подписке; позже можно добавить
  альтернативный раннер (свой ключ юзера / его Claude), не меняя приём артефакта и деплой.

## 10. Риски / открытые вопросы

- **Определение build-output.** Агент генерит произвольный проект; надо надёжно понять, что билдить и
  где `dist/`. Решение M2: диспетчер даёт агенту чёткий контракт («статический проект, вывод в
  `dist/`»); агент сам приводит к контракту. Плоский `index.html` без билда — тоже валиден.
- **Пропускная способность диспетчера** — сколько задач сервисный пул тянет параллельно (ограничено
  машинами/подписками пула). Контролируется размером пула + бюджет-гейтом. На масштабе — больше машин.
- **wildcard-TLS** через DNS-01 — операционная задача владельца.
