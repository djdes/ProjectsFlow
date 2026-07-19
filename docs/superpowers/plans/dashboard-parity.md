# План: паритет дашборда проекта с Base44

Дата: 20 июля 2026. Источники наблюдений — `reference/base44-dashboard/`
(`behavior.md`, `repository-audit.md`, `README.md`, `actual/*.json`, `sections.json`,
`screenshots/sec-*.png`). Наблюдение за Base44 велось только на чтение.

## Решение по объёму (принято, не пересматриваем)

Переносим **все 14 функциональных разделов**: Overview, Users, Data, Analytics,
Marketing, Domains, Integrations, Security, Code, Agents, Workflows, Logs, API, Settings.

Разделы, закрытые у Base44 подпиской (Integrations сверх базового набора, Code editing,
Workflows, custom domains) — наблюдать их поведение мы не могли, поэтому **придумываем
свою логику по смыслу названия**; обоснование каждого решения — в разделе 5.

**Не переносим монетизацию Base44**: кредиты («Earn credits»), баннер «30% off»,
кнопки «Upgrade plan» / «View Plans», локи «This feature is only available on the Builder
plan». У ProjectsFlow своя тарифная система (`server/src/domain/billing/pricing.ts`,
usage/limits), дашборд проекта в неё не встраивается.

## Исходное состояние (важно для оценки объёма)

Вопреки `repository-audit.md` (писался 18 июля), к 20 июля **каркас дашборда уже
существует и заполнен**:

- `client/src/presentation/components/project/workspace/ProjectDashboard.tsx` — оболочка,
  sidebar на `md:`, мобильный `<select>` разделов (паритет по навигации достигнут);
- `.../dashboard/dashboardConfig.ts` — все 14 разделов, `normalizeCustomDomain`,
  `buildProjectOpenApi`;
- `.../dashboard/DashboardSections.tsx` (3214 строк) — 12 секций;
- `.../workspace/AppDataExplorer.tsx` (497 строк) — Data explorer;
- `.../workspace/AppLogsPanel.tsx` (398 строк) — Logs;
- `.../dashboard/RepositoryCodeEditor.tsx` (445 строк) — Code;
- сервер: `server/src/application/app-backend/*` — `ManageAppBackendData`,
  `AppDashboardSettings`, `RunAppQuery`, `ProvisionAppBackend`, `AppAuthService`;
- порт `client/src/application/project/ProjectRepository.ts` — методы
  `getAppBackendDashboard`, `getAppDashboardSettings`, `updateAppDashboardSettings`,
  `verifyAppCustomDomain`, `testAppWebhook`, `scanAppSecurity`, `listAppRuntimeUsers`,
  `queryAppRows`, `createAppRow`, `updateAppRow`, `deleteAppRow`, `revealAppRowValue`,
  `updateAppTablePermissions`.

Поэтому это **план добивки и укрепления**, а не greenfield. Оценки ниже исходят из
реального кода, а не из аудита недельной давности.

---

## 1. Таблица по разделам

| # | Раздел | У нас сейчас | У Base44 (наблюдение) | Что делаем |
|---|---|---|---|---|
| 1 | **Overview** | `OverviewSection` (DashboardSections.tsx:141): имя, иконка (`ProjectIconPicker`), описание, дата, usage-бар, visibility, приглашение, platform badge, `HealthRow` (:421) | H1 имени + inline-edit, «App Visibility» (Public + Copy Link), «Invite Users», «Platform Badge», «View usage», «Earn credits», «Upgrade plan 30% off», «Publish App» | **Паритет достигнут.** Добить: явную кнопку «Опубликовать» в шапке раздела (сейчас публикация живёт вне дашборда) и health-строку по последнему деплою. Кредиты/upgrade — не переносим |
| 2 | **Users** | `UsersSection` (:448): 2 вкладки — «Пользователи приложения» (runtime, из `_users`) и «Команда» (`members`), поиск, фильтр роли, revoke сессий, удаление runtime-юзера | «Users (3)» / «Pending requests», поиск «Search by Email or Name», «all roles», «Invite User», таблица имя/роль/email | **Почти паритет.** Не хватает вкладки **«Заявки»** (pending requests) для runtime-пользователей и bulk-действий. Email в списке маскируется — оставляем, точечный reveal под `update_project` |
| 3 | **Data** | `AppDataExplorer` (497 строк): карточки таблиц, поиск, A–Z, грид, typed-фильтры (`FilterPopover`:349), сортировка, пагинация, `RowEditorSheet`:387 (правая панель), create/update/delete, `PermissionsDialog`:490 (CRUD-правила), reveal значения, пустые состояния | Карточки сущностей 370×82, «Scan»/«Dismiss», A-Z, schema-aware grid, typed filters, permissions CRUD, «Add item», клик строки → правая панель, пустое состояние | **Готов** (см. срез 0). Долги: optimistic concurrency, выгрузка с лимитами, явный флаг `sensitive` в схеме |
| 4 | **Analytics** | `AnalyticsSection` (:799): просмотры/зрители/маршруты/таблицы, столбчатый график по дням, список зрителей. Источник — `ProjectAnalytics` = просмотры **страницы проекта в ProjectsFlow** | Live visitors + аналитика опубликованного приложения; для неопубликованного — пустое состояние | **Главный содержательный разрыв.** Мы показываем внутреннюю метрику, Base44 — трафик самого приложения. Срез 3: собирать `app.user.page_visit` с опубликованного сайта и разделить «Приложение» / «Карточка проекта» |
| 5 | **Marketing** | `MarketingSection` (:915): SEO Overview / Meta tags / Advanced (canonical, robots, structured data), генератор social content | «SEO & GEO» с Overview/Meta tags/Advanced Settings + генератор social content | **Паритет достигнут.** Ничего не делаем; social-генератор оставляем как есть (в `repository-audit.md` он числился «не переносить», но уже написан — удалять дороже, чем оставить) |
| 6 | **Domains** | `DomainsSection` (:1256): встроенный URL + копирование, custom domain (`normalizeCustomDomain`, `verifyAppCustomDomain`), статус `none/pending/verified/error` | «Built-in URL» + «Edit URL», «Custom domains» (закрыто: «Use your custom domain» disabled, «View Plans»), «Email domain» | **Паритет + сверх.** У нас custom domain реально работает, у Base44 закрыт тарифом. Добить: редактирование встроенного slug и DNS-инструкцию с конкретной записью |
| 7 | **Integrations** | `IntegrationsSection` (:1428): GitHub, База знаний, Telegram, email-sender, webhook (+`testAppWebhook`), OAuth issuer | 50+ коннекторов (Stripe, Gmail, Slack, Notion, Airtable, Linear…), Skills, OAuth connectors; большая часть закрыта тарифом | **Сознательно расходимся.** Каталог из 50 коннекторов — не наш продукт. Своя логика: срез 6 — «исходящие вебхуки по событиям проекта» + реестр коннекторов из 4–6 штук, которые у нас реально есть |
| 8 | **Security** | `SecuritySection` (:1764): `scanAppSecurity` → `AppSecurityFinding[]` (`info/warning/critical`), remediation | «Check the security of your app», «Check Security», Advanced Security Settings | **Паритет достигнут.** Добить: правила скана про новые поверхности (срез 4) и историю сканов |
| 9 | **Code** | `CodeSection` (:1894) + `RepositoryCodeEditor` (445 строк): дерево файлов GitHub-репозитория, редактирование, коммит, защита по SHA | Дерево + split view; **редактирование закрыто тарифом** («Code editing is only available on paid plans») | **Паритет + сверх.** У нас редактирование работает и защищено SHA. Добить: split view (diff до/после) — единственное, чего нет |
| 10 | **Agents** | `AgentsSection` (:1920): выбор диспетчера проекта (`DispatcherCandidate`, `dispatcherUserId`) | «Create your first agent», suggested agents, разделы Guidelines/Tools/Connectors/Skills/Memory/Channels | **Сознательно расходимся.** У Base44 агент = чат-бот для конечных пользователей; у нас агент = воркер, делающий задачи. Своя логика: срез 7 — карточка воркера (диспетчер, capabilities, параллельность, LIVE-статус) |
| 11 | **Workflows** | `WorkflowsSection` (:2084): статус автономного цикла (`AutomationConfig`), диспетчер, параллельная обработка, вход в настройку | Полностью закрыт тарифом — наблюдать нечего | **Придумываем сами** (срез 8): правила «событие → действие» поверх уже существующего `AutomationConfig` |
| 12 | **Logs** | `AppLogsPanel` (398 строк): вкладки, фильтр таблицы/события/пользователя, «только ошибки», refresh, раскрываемая строка. Источник — **только** `app_audit` | Refresh, All Categories, All Events, email-фильтр, тип/пользователь/время, expand row. Категории: `app.entity.query`, `app.user.page_visit`, `api.code.editing`, `app.user.invited`, `app.user.registered` | **Разрыв по охвату.** У нас только аудит Data explorer. Срез 2: свести в одну ленту runtime приложения + действия воркера + публикацию + auth-события |
| 13 | **API** | `ApiSection` (:2277): вкладки docs/sdk/openapi, `buildProjectOpenApi` (GET/POST коллекции, PATCH/DELETE записи), JS-снипет, копирование, скачивание | Генерируемая дока, JS SDK, Authentication, «Copy for LLM», «Copy all», per-entity endpoints включая `/bulk` (POST/PUT), `/update-many`, `/{id}/restore` | **Паритет по каркасу, разрыв по объёму.** Срез 5: bulk-эндпоинты, `restore` (нужен soft-delete), поля `updated_date`/`created_by_id` в доке, кнопка «Скопировать для LLM» |
| 14 | **Settings** | `SettingsSection` (:2544): метаданные, главная страница, visibility, badge, тест-данные, session recordings, `AuthRow` (:3168) по провайдерам, удаление проекта | App metadata, main page, visibility, badge, clone/template, test data, session recordings, delete; Authentication: email/password, Google, Microsoft, Facebook, Apple, SSO | **Паритет достигнут.** Провайдеры кроме email/password — в состоянии `pending` (флаг есть, реализации нет). Срез 9: включить хотя бы Google реально либо честно пометить «скоро» |

---

## 2. Вертикальные срезы в порядке ценности

Срез = самостоятельная ценность для пользователя, доводится до конца до начала следующего.

### Срез 0. Data explorer — ГОТОВ, есть долги

**Статус: сделано.** `AppDataExplorer.tsx` + `ManageAppBackendData.ts` закрывают весь
список из `behavior.md` § Data: карточки сущностей, поиск таблиц, A–Z, schema-aware grid,
поиск по полям, обе прокрутки, typed filters, permissions CRUD, Add item, правая
редактируемая панель по клику строки, пустое состояние.

Долги, которые надо закрыть до того, как поверх Data строится что-то ещё:

**Долг 0.1 — optimistic concurrency.**
Сейчас `ManageAppBackendData.updateRow` пишет по `id` без проверки версии: два админа,
открывшие одну строку, молча затирают правки друг друга (last-write-wins).
- Миграция: `db/136_app_row_version.sql` — по строкам per-project SQLite это не MariaDB-миграция;
  фактическая работа в `infrastructure/app-backend/SqliteAppDatabaseStore` — добавить
  колонку `updated_at` в `ensureDatabase` (создание таблиц по схеме) с обратной
  совместимостью для уже созданных БД (`PRAGMA table_info` → `ALTER TABLE ADD COLUMN`).
- Домен: `AppSchema.ts` — служебная колонка `updated_at` наравне с `id`/`owner_id`/`created_at`.
- Application: `updateRow(projectId, caller, table, rowId, values, expectedUpdatedAt)`,
  новая ошибка `AppRowConflictError` в `domain/app-backend/errors.ts`.
- Presentation: `RowEditorSheet` шлёт `updated_at` открытой строки; на 409 — тост
  «Запись изменена другим участником» и перезагрузка панели без потери введённого.
- **Риск:** уже существующие проектные SQLite без колонки. Миграция обязана быть
  idempotent и не ронять `ensureDatabase` на старых базах.
- **Готово когда:** тест в `ManageAppBackendData.test.ts` — два последовательных апдейта
  с одним `expectedUpdatedAt`, второй падает `AppRowConflictError`; UI показывает конфликт.

**Долг 0.2 — выгрузка с ограничениями.**
Выгрузки сейчас **нет вообще** (в `AppDataExplorer.tsx` нет ни CSV, ни download).
Это удача: проектируем сразу с ограничениями, а не чиним потом.
- Application: `exportRows(projectId, caller, table, query)` в `ManageAppBackendData` —
  требует `update_project` (не `read_project`: выгрузка ≠ просмотр);
  жёсткий потолок 10 000 строк; чувствительные колонки **не выгружаются вовсе**
  (не маскированными — их просто нет в CSV, иначе получаем файл, по которому оракул
  гоняется офлайн); обязательная запись `dashboard.export` в аудит с числом строк и
  списком колонок.
- Presentation: кнопка «Выгрузить CSV» в шапке грида, дизейбл без прав, предупреждение
  «Чувствительные колонки в файл не попадут» + счётчик строк до подтверждения.
- **Риск:** выгрузка — самый удобный вектор утечки; лимит и аудит не опциональны.
- **Готово когда:** тест — выгрузка таблицы с полем `api_key` не содержит ни значения,
  ни маски, ни колонки; превышение 10 000 обрезается и явно сообщается в UI.

**Долг 0.3 — явный флаг `sensitive` в схеме.**
Сейчас чувствительность определяется эвристикой по имени поля —
`server/src/domain/app-backend/sensitiveFields.ts`, `classifyField()`. Это заведомо
дырявый механизм: поле `passport_series` ловится, `doc_number` — нет; воркер, назвавший
колонку `pk` или `ключ_доступа`, обходит защиту молча.
- Домен: `AppField` (`domain/app-backend/AppSchema.ts`) → `readonly sensitive?: 'secret' | 'pii'`.
- Application: `validateAppSchema.ts` принимает и валидирует флаг;
  `sensitiveColumns()` = **объединение** явного флага и эвристики (эвристика остаётся
  страховочной сеткой для схем, написанных воркером без флага, и **никогда** не отключается
  явным `sensitive: undefined` — снять защиту можно только осознанно через UI).
- Presentation: в `PermissionsDialog` (или соседней вкладке) — переключатель
  чувствительности поля, доступный `update_project`, с записью в аудит.
- **Миграция:** не нужна — схема лежит в `app_backends.schema_json`, поле опциональное.
- **Риск:** возможность **снять** флаг — это возможность раскрыть колонку. Снятие
  логируем как `dashboard.sensitivity_changed` и показываем в Security как finding.
- **Готово когда:** тест — поле с `sensitive: 'secret'` и нейтральным именем `note`
  маскируется, не сортируется, не ищется, не фильтруется по значению; тест — снятие
  флага пишется в аудит.

### Срез 1. Overview: публикация и здоровье (S)

Замкнуть Overview на реальное состояние результата: кнопка публикации, статус
последнего деплоя, ссылка на сайт.
- Presentation: `DashboardSections.tsx` → `OverviewSection`, `HealthRow`.
- Application: переиспользуем `getProjectSite` (`ProjectSite.deployedAt`, `fileCount`).
- Миграции: нет.
- **Риск:** дублирование публикации с уже существующим местом запуска — сначала найти его
  и переиспользовать вызов, а не писать второй путь.
- **Готово когда:** из Overview видно, опубликован ли проект, когда, и открывается сайт.

### Срез 2. Unified Logs (M) — наибольшая ценность после Data

Свести в одну ленту то, что сейчас разнесено: аудит Data explorer (`app_audit`),
действия воркера (`task_progress_events`, `live_sessions`), публикацию сайта,
auth-события runtime (`AppAuthService`).
- Домен: `server/src/domain/app-backend/AppLogEntry.ts` — единый тип с категорией
  (`data` / `auth` / `worker` / `publish` / `runtime`), по образцу категорий Base44.
- Application: `server/src/application/app-backend/QueryAppLogs.ts` — слияние источников
  с курсорной пагинацией по времени.
- Infrastructure: адаптеры чтения к существующим таблицам; **без новой таблицы-агрегата** —
  дублирование данных ради удобства чтения создаст вторую точку утечки.
- Presentation: `AppLogsPanel.tsx` — селектор категорий («Все категории» как у Base44),
  фильтр по пользователю, «только ошибки», expand row.
- Миграции: нет (читаем существующие таблицы).
- **Риск:** слияние разнородных источников с разной пагинацией — медленно. Ограничить
  окно 30 днями и не давать offset-пагинацию глубже 1000.
- **Риск безопасности:** в `detail` событий воркера могут лежать куски промптов и путей.
  Прогнать `detail` через тот же список чувствительных токенов перед отдачей.
- **Готово когда:** одна лента показывает событие Data explorer, вход runtime-юзера,
  запуск воркера и публикацию; фильтр по категории и по пользователю работает.

### Срез 3. Analytics приложения (M)

Разделить «просмотры карточки проекта» (есть) и «трафик опубликованного приложения» (нет).
- Миграция: `db/136_app_runtime_analytics.sql` — таблица `app_page_visits`
  (project_id, path, session_hash, user_agent_class, created_at). **Без IP и без raw UA** —
  агрегат, а не журнал слежки.
- Домен: `domain/app-backend/AppTraffic.ts`.
- Application: `application/app-backend/RecordAppVisit.ts` + `GetAppTraffic.ts`.
- Presentation: `AnalyticsSection` — переключатель «Приложение / Карточка проекта»,
  пустое состояние «Приложение ещё не опубликовано» (как у Base44).
- **Риск:** приём событий с публичного сайта — открытый неаутентифицированный эндпоинт.
  Обязателен rate-limit по project_id и потолок записей в сутки, иначе это вектор
  раздувания квоты проекта.
- **Готово когда:** после публикации и захода на сайт в Analytics растёт счётчик,
  для неопубликованного — пустое состояние.

### Срез 4. Security: покрытие новых поверхностей (S)

- Application: `AppDashboardSettings`/scan — добавить проверки:
  таблица с `read: 'anyone'` и чувствительной колонкой; колонка с чувствительным именем
  без флага `sensitive`; недавнее снятие флага; выгрузка > 1000 строк за сутки;
  включённый `testData` на публичном проекте.
- Presentation: `SecuritySection` — история сканов, severity-фильтр.
- Миграции: нет (findings считаются на лету).
- **Готово когда:** созданная таблица с публичным чтением и полем `api_key` даёт
  `critical` finding с внятным remediation.

### Срез 5. API-раздел до объёма Base44 (M)

- `dashboardConfig.ts` → `buildProjectOpenApi`: добавить `/bulk` (POST/PUT),
  `/update-many`, `/{id}/restore`, служебные поля `updated_date`/`created_by_id`,
  секцию `securitySchemes` (Bearer).
- Server: соответствующие маршруты в app-runtime + soft-delete (без него `restore`
  бессмыслен) — колонка `deleted_at` в таблицах приложения.
- Presentation: `ApiSection` — кнопка «Скопировать для LLM» (вся дока одним markdown).
- **Риск:** bulk-операции обходят построчные проверки прав — правила
  `appAccessForOperation` применять к каждой строке батча, не к запросу целиком.
  Потолок размера батча 100.
- **Готово когда:** OpenAPI из дашборда валиден, bulk-создание уважает `owner`-правило.

### Срез 6. Integrations: исходящие вебхуки (M) — своя логика

См. обоснование в разделе 5.
- Миграция: `db/137_project_webhooks.sql` — `project_webhooks`
  (id, project_id, url, secret_hash, events_json, enabled, last_status, last_at).
- Домен: `domain/integrations/ProjectWebhook.ts`.
- Application: `application/integrations/{ManageWebhooks,DispatchWebhook}.ts`.
- Presentation: `IntegrationsSection` — список подписок, выбор событий, «Проверить»
  (уже есть `testAppWebhook` — расширить), журнал последних доставок.
- **Риск SSRF:** URL вебхука задаёт пользователь. Запретить приватные диапазоны
  (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7), запретить редиректы,
  таймаут 5 с. Иначе вебхук — сканер внутренней сети VPS.
- **Риск:** секрет подписи не показываем повторно после создания (см. раздел 4).
- **Готово когда:** создание задачи в проекте доставляет подписанный POST на внешний URL,
  попытка указать `http://127.0.0.1:4317` отклоняется с внятным сообщением.

### Срез 7. Agents: карточка воркера (S) — своя логика

- Presentation: `AgentsSection` — к выбору диспетчера добавить: capabilities проекта
  (`db/126_project_scoped_agent_capabilities.sql`), режим параллельности
  (`project.multiTaskWorker`), состояние LIVE-сессии, последние запуски.
- Application: переиспользуем `liveService` и `AutomationConfig`.
- Миграции: нет.
- **Готово когда:** из раздела видно, кто диспетчер, что ему разрешено, и идёт ли работа.

### Срез 8. Workflows: правила «событие → действие» (L) — своя логика

- Миграция: `db/138_project_workflows.sql` — `project_workflows`
  (id, project_id, trigger_json, action_json, enabled, last_run_at, last_status).
- Домен: `domain/automation/WorkflowRule.ts` (триггеры: задача создана / перешла в статус /
  дедлайн через N часов / пришёл вебхук; действия: делегировать, поставить приоритет,
  отправить в Telegram, дёрнуть исходящий вебхук).
- Application: `application/automation/{ManageWorkflows,RunWorkflow}.ts`.
- Presentation: `WorkflowsSection` — конструктор правил поверх текущего статуса автономного цикла.
- **Риск:** зацикливание (правило порождает событие, запускающее себя же). Счётчик глубины
  каскада и отключение правила после 3 срабатываний подряд из одного корня.
- **Готово когда:** правило «задача → done ⇒ сообщение в Telegram» отрабатывает и пишет в Logs.

### Срез 9. Auth-провайдеры (M)

- Довести `auth.google` из `pending` в рабочее состояние (остальные — честно «скоро»,
  без имитации переключателя, который ничего не делает).
- **Готово когда:** runtime-пользователь входит в опубликованное приложение через Google,
  событие видно в Logs.

---

## 3. Порядок и связность

```
Срез 0 (долги Data) ──► Срез 2 (Logs) ──► Срез 4 (Security)
        │                    │
        ├──► Срез 1 (Overview)
        ├──► Срез 5 (API)
        └──► Срез 3 (Analytics)
Срез 6 (Webhooks) ──► Срез 8 (Workflows)
Срез 7 (Agents) — независим
Срез 9 (Auth) — независим
```

Долги среза 0 идут первыми: и optimistic concurrency, и флаг `sensitive` меняют форму
данных, поверх которой строятся Logs, Security и API. Делать их после — переписывать.

---

## 4. БЕЗОПАСНОСТЬ

### Урок этого захода

Мы маскировали чувствительные значения в выдаче Data explorer и считали задачу решённой.
Это было неверно: **маскирование бесполезно, если рядом остаются поиск, фильтры и
сортировка по тем же колонкам.**

Каждый из трёх механизмов — оракул, восстанавливающий скрытое значение:

- **Поиск.** `search=sk_live_a` вернул строку → первый символ после префикса найден.
  Дальше побайтово: `sk_live_ab`, `sk_live_ac`… Ключ восстанавливается за число запросов,
  линейное по длине, при том что на экране всё это время стоит `••••••••`.
- **Фильтр по значению.** `api_key starts_with X` — тот же перебор, только явный.
  `eq` даёт проверку гипотезы, `gt`/`lt` — двоичный поиск (быстрее посимвольного).
- **Сортировка.** Порядок строк по скрытой колонке — это компаратор. Вместе с пагинацией
  сортировка выдаёт относительный порядок всех значений; несколько известных строк
  («канареек», которые атакующий сам создал через публичный runtime) превращают порядок
  в позиционную оценку каждого чужого значения.

Это применимо к **PII ровно так же, как к секретам**. Номер карты подбирается тем же
перебором, что и API-ключ; «маскируем частично, оставляя хвост» не спасает — хвост
сокращает пространство перебора.

### Что уже сделано в коде

`ManageAppBackendData.listRows` (`server/src/application/app-backend/ManageAppBackendData.ts`):

- сортировка по чувствительной колонке → `AppSchemaInvalidError` (:126-128);
- свободный поиск идёт только по `[...columns].filter((c) => !sensitive.has(c))` (:136-141);
- `normalizeFilter` (:411-431) по чувствительной колонке допускает **только**
  `is_empty` / `is_not_empty` — операторы, не сравнивающие со значением;
- раскрытие — отдельная операция `revealRowValue` (:162-184): требует `update_project`
  и **всегда** пишет `dashboard.reveal` в аудит.

Три механизма закрыты. Проверки на месте, но они держатся на дисциплине.

### Правило для любого нового поля выдачи

**Любое новое поле, колонка, фильтр, сортировка, агрегат, экспорт или лента событий
проверяется на этот класс атак до мержа.** Контрольные вопросы:

1. Может ли клиент повлиять на **сравнение** со скрытым значением (eq, contains,
   starts_with, gt/lt, регэксп, «похожие записи»)? → запретить.
2. Может ли клиент наблюдать **порядок**, зависящий от скрытого значения (сортировка,
   «топ», ранжирование, дефолтный порядок)? → запретить.
3. Может ли клиент наблюдать **количество** при управляемом им условии
   (счётчик совпадений, «найдено N», фасеты, гистограмма)? → запретить: счётчик —
   тот же булев оракул, только без строк.
4. Может ли клиент наблюдать **разницу во времени ответа**? Индексный поиск по префиксу
   быстрее полного скана. → для чувствительных колонок вообще не строить путей запроса.
5. Уходит ли значение в **побочный канал**: экспорт, лог, `detail` аудита, текст ошибки
   («значение X нарушает unique»), вебхук, аналитика, сообщение в Telegram? → вычистить.
6. **Агрегаты тоже утекают**: `MIN`/`MAX`/`AVG` по скрытой колонке, «сколько записей
   с одинаковым значением» — раскрывают ровно то, что мы прячем.

### Прямые следствия для срезов этого плана

- **Срез 0.2 (выгрузка):** чувствительные колонки не попадают в файл вовсе. Маска в CSV
  бесполезна, а лимит 10 000 строк — граница ущерба, не защита.
- **Срез 2 (Logs):** `detail` событий и текст ошибок — побочный канал. `dashboard.reveal`
  фиксирует факт раскрытия и колонку, но **никогда не само значение**.
- **Срез 3 (Analytics):** никаких фасетов и «топ значений» по колонкам приложения.
- **Срез 5 (API):** bulk и `update-many` принимают запрос-условие — условие по
  чувствительной колонке возвращает счётчик изменённых строк, то есть оракул. Запретить
  так же, как в `normalizeFilter`.
- **Срез 6 (Webhooks):** секрет подписи показывается **один раз** при создании; в базе —
  хеш. Иначе раздел Integrations становится хранилищем открытых секретов, а весь
  механизм маскирования в Data — декоративным.

---

## 5. Что придумываем сами для закрытых разделов

Для этих разделов у Base44 стоял paywall — поведение наблюдать было нельзя
(`sections.json` → `locked`). Копировать нечего, поэтому проектируем от смысла названия
и от того, что у ProjectsFlow уже есть.

**Integrations.** У Base44 — каталог 50+ SaaS-коннекторов (Stripe, Gmail, Slack, Notion,
Airtable, Salesforce…), большинство закрыто тарифом. Повторять это бессмысленно:
каталог интеграций — самостоятельный продукт на годы поддержки, и он не решает задачу
ProjectsFlow. Наша логика: **исходящие вебхуки по событиям проекта** плюс честный список
из 4–6 интеграций, которые у нас **реально работают** (GitHub, Telegram, база знаний,
email-отправитель, OAuth issuer). Вебхук — универсальный адаптер: он даёт пользователю
подключиться к чему угодно через Make/n8n, не заставляя нас писать 50 коннекторов.
Список без заглушек: карточка появляется, только если интеграция действительно работает.

**Code.** У Base44 редактирование закрыто («Code editing is only available on paid
plans»), доступен просмотр и «Split view». У нас `RepositoryCodeEditor` уже **умеет
больше** — правит файлы GitHub-репозитория и коммитит с защитой по SHA. Придумываем
недостающее: split view как **diff рабочей версии против HEAD** перед коммитом. Это
осмысленнее подсмотренного «два файла рядом»: у нас редактирование настоящее, а значит
ценность — увидеть, что именно уйдёт в коммит.

**Workflows.** Полностью закрыт, наблюдать нечего, известно только описание:
«Automated actions on a schedule or when a trigger happens». У нас уже есть автономный
цикл (`AutomationConfig`), диспетчер и планировщик Telegram-дайджестов — то есть
инфраструктура триггеров существует, не хватает пользовательских правил. Наша логика:
конструктор правил «событие → действие» над **существующими** сущностями (задачи,
статусы, дедлайны, участники, вебхуки). Не пытаемся сделать общий workflow-движок:
замкнутый набор триггеров и действий проверяем статически, что закрывает и класс атак
из раздела 4 (никаких пользовательских выражений над данными), и зацикливание.

**Custom domains.** У Base44 закрыт («Use your custom domain» disabled + «View Plans»).
У нас `normalizeCustomDomain` и `verifyAppCustomDomain` **уже написаны** и работают.
Придумываем недостающую часть UX: показ конкретной DNS-записи (CNAME на
`<slug>.projectsflow.ru`), статус проверки и понятный текст ошибки. nginx-конфиги при
этом не трогаем (правило проекта) — домен обслуживается существующим wildcard.

**Agents.** У Base44 раздел открыт, но смысл другой: агент = чат-бот для конечных
пользователей приложения (Guidelines / Tools / Connectors / Skills / Memory / Channels).
У ProjectsFlow «агент» уже занят другим значением — воркер, выполняющий kanban-задачи.
Строить второе понятие агента в том же UI — гарантированная путаница. Наша логика:
раздел показывает **воркера проекта** (диспетчер, capabilities, параллельность,
LIVE-сессия, история запусков). Название раздела совпадает, содержание — наше.

---

## 6. Проверка перед завершением любого среза

```bash
cd c:/www/ProjectsFlow && npm run typecheck && npm run lint && npm test
```

Тесты — `node:test` + `node:assert/strict`, рядом с изменённым кодом, по образцу
`ManageAppBackendData.test.ts` и `dashboardConfig.test.ts`.

Отдельно для каждого среза, добавляющего поле выдачи: тест-негатив на оракул —
попытка отсортировать, поискать и отфильтровать по чувствительной колонке должна
падать, а не возвращать данные.
