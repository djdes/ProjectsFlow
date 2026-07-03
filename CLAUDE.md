# CLAUDE.md — правила работы в репозитории ProjectsFlow

Этот файл читают AI-ассистенты (Claude Code, Copilot, и т.д.) и любой
новый разработчик. Он короткий — не разрастаемся.

> **Доступы, git, деплой, прод-окружение целиком** — в [docs/ONBOARDING.md](docs/ONBOARDING.md).
> Этот файл — только короткие правила работы. Не дублируй сюда креды.

## Контекст проекта

- **Что это.** Платформа управления проектами (сайты, ПО и т.д.). Multi-tenant SaaS
  в планах; сейчас собираем поэтапно: Spec #1 — UI-скелет на моках, дальше — backend,
  auth, multi-tenancy. Дизайн-доки лежат в [docs/superpowers/specs/](docs/superpowers/specs/).
- **Где живёт.** FastPanel на VPS `projectsflow.ru` (Azure Ubuntu 24.04).
  Код приложения: `/var/www/projectsflow/data/www/projectsflow.ru/`.
- **Статус.** В переходе: лендинг снесён, платформа строится в `client/` (UI) и `server/`
  (backend появился в Spec #2). Катим на прод по мере готовности (push в `main` → автодеплой).

## Стек

- **Node.js 22 LTS** (на сервере через nvm, см. `.nvmrc`).
- **Express 4** + **mysql2/promise** на бэке. ESM, TypeScript. (Сейчас бэк — пустой скелет.)
- **Vite + React 19 + TypeScript + Tailwind + shadcn/ui** на фронте.
  React-роутинг — `react-router-dom` v7. Состояние — React Context (без TanStack Query
  до прихода HTTP-слоя в Spec #2).
- **MariaDB 10.11** (совместима с MySQL 8). Кодировка `utf8mb4`.
- **PM2** для процесса на сервере (`ecosystem.config.cjs`).
- **nginx** (FastPanel, reverse proxy) проксирует домен → `127.0.0.1:4317`.

Next.js, NextAuth, RSC, Server Actions — **не используем**. Решение зафиксировано
в брейншторме (см. `docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md`,
секция 1): чистая граница client↔server проще поддерживает Clean Architecture.

## Архитектура client/ (Clean Architecture)

Четыре слоя с **однонаправленными** зависимостями, плюс две поддерживающие папки:

```
client/src/
├── domain/         ← entities, value objects. 0 deps на React/HTTP/DOM
├── application/    ← ports (repository-interfaces) + use-cases. Зависит только от domain
├── infrastructure/ ← адаптеры (mock, в будущем http) + DI-контейнер. Реализует порты
├── presentation/   ← React: layout, pages, hooks, theme, app/routes. НЕ знает про конкретные адаптеры
├── components/ui/  ← shadcn-примитивы (button, dropdown-menu и т.д.)
├── lib/            ← shared утилиты (cn helper)
└── styles/         ← globals.css (Tailwind + дизайн-токены)
```

Правила импорта (защищены `eslint-plugin-boundaries` в `client/eslint.config.js`):

| Слой | Импортирует из |
|---|---|
| `domain` | — |
| `application` | `domain` |
| `infrastructure` | `domain`, `application` |
| `presentation` | `domain`, `application`, `lib/`, `components/ui/` |

`presentation` НЕ импортирует из `infrastructure/mock/*` или `infrastructure/http/*` напрямую —
только через DI-контейнер `infrastructure/di/container.tsx` (единственный мост).
Этот контекст устроен как singleton на уровне модуля.

При добавлении новой фичи: сначала domain, потом application (порт + use-case),
потом mock-реализация в infrastructure, потом UI. Не наоборот.

## Структура и где что менять

- Новый shadcn-компонент → `npx shadcn@latest add <name>` (положит в `client/src/components/ui/`).
- Новая страница → компонент в `client/src/presentation/pages/`, маршрут в `presentation/app/routes.tsx`.
- Новый use-case → класс в `client/src/application/<feature>/<UseCase>.ts`, передать в `container.tsx`.
- Новый mock-репозиторий → реализует порт из `application/`, регистрируется в `container.tsx`.
- Дизайн-токены (цвета, скругления) — CSS-переменные в `client/src/styles/globals.css`,
  Tailwind-маппинг в `client/tailwind.config.ts`. Палитра: slate-нейтрали + один синий акцент.
- Шрифты подключаются через `@fontsource-variable/*` в `main.tsx`, без CDN.
- Миграции БД — новый файл `db/00N_*.sql` (append-only, MariaDB-совместимый синтаксис).

## Переменные окружения

Файл `.env` (НЕ коммитим, шаблон — `.env.example`).

| Переменная | Локально | На сервере |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `PORT` | `4317` | `4317` |
| `DB_HOST` / `DB_PORT` | `projectsflow.ru` / `3306` (если открыт remote TCP) | — |
| `DB_SOCKET` | — | `/run/mysqld/mysqld.sock` |

Если задан `DB_SOCKET` — код использует unix-сокет, игнорирует `DB_HOST/DB_PORT`.
Боевые значения — в [docs/ONBOARDING.md](docs/ONBOARDING.md), раздел 1.

## npm-скрипты (из корня)

```bash
npm run dev          # одновременно client (Vite :5173) + server (tsx :4317)
npm run dev:client   # только Vite
npm run dev:server   # только Express
npm run build        # сборка обоих workspaces
npm run typecheck    # tsc --noEmit в client/
npm run lint         # eslint в client/
npm run db:migrate   # node scripts/migrate.mjs
npm run deploy       # node scripts/deploy.mjs
```

## Деплой

```bash
npm run deploy
```

Подробности — [docs/ONBOARDING.md](docs/ONBOARDING.md), раздел 4. Push в `main` триггерит
автодеплой на прод (`.github/workflows/deploy.yml`) — катим по мере готовности.

## SSH / Git / доступы

Хост `projectsflow.ru`, юзер `projectsflow`. Порт `22` изнутри LAN, `50222` из интернета.
Bare repo: `/var/www/projectsflow/data/git/projectsflow.git`, ветка `main`.
Полные URL, пароли — [docs/ONBOARDING.md](docs/ONBOARDING.md).

Workflow: фича → ветка → merge в `main` → автодеплой (или `npm run deploy` вручную).

## Ритуал коммита: sync с kanban-задачами через MCP

У ProjectsFlow есть свой MCP-сервер (`@projectsflow/mcp-server`) который даёт Claude Code
доступ к kanban-задачам проекта. **Если этот MCP подключён** (`pf_list_projects` доступен в
твоих tool'ах) — следуй ритуалу ниже, когда юзер просит «сделай и закоммить».

**Перед `git commit`:**

1. `pf_list_projects` → найди id текущего проекта (один раз за сессию; кешируй для себя).
2. `pf_list_tasks {projectId}` → прочитай открытые задачи (`status: todo` или `in_progress`).
3. Сопоставь staged diff + планируемый commit-message с заголовками/описаниями задач.
   - Если в commit-message юзер написал явный ID (`Closes PF-…`, `Refs #…`) — уважай его абсолютно.
   - Иначе — сам суди по содержанию.
4. **Не делай move молча.** Если нашёл одного разумного кандидата — спроси юзера через
   AskUserQuestion: «Похоже, это закрывает «\<title>» (id=\<short>). Привязать коммит и
   перенести в done?». Если кандидатов несколько или ни одного — просто скажи что не нашёл
   и коммить как обычно.

**После `git push`:**

5. `pf_link_commit_to_task {projectId, taskId, sha}` — server pull'ит коммит с GitHub и
   делает snapshot. Auto-transitions `todo → in_progress` на первом коммите задачи —
   отдельный `pf_move_task` для этого не нужен.
6. Если юзер подтвердил «перенести в done» — `pf_move_task {projectId, taskId, targetStatus: 'done'}`.

**Чего НЕ делай:**

- Не зови `pf_link_commit_to_task` ДО `git push` — sha ещё не на GitHub, server вернёт 404 GithubApiError.
- Не дёргай MCP-tool'ы для каждого мелкого fixup-коммита («typo», «format»). Один task ↔ один semantic-feature commit; для fixup'ов в той же фиче — просто коммить.
- Не двигай задачи в `done` без явного подтверждения. `todo → in_progress` происходит автоматически по `pf_link_commit_to_task`; в `done` — только когда юзер сказал.

См. `mcp-server/README.md` для полной справки по tool'ам.

**Agent-runner tools** (`pf_list_pending_agent_jobs`, `pf_claim_agent_job`,
`pf_complete_agent_job`) — используются slash-командой `/check-agent-queue` через
`/loop`-сессию (см. `docs/ONBOARDING.md` → § 6.5 «Agent runner локально»). Если ты
**обычная** интерактивная сессия (не запущенная в /loop через slash-command'у) — НЕ
трогай эти tool'ы. Они для автоматического agent runner'а, не для ручной работы.

## Комментирование задач по ходу разработки

Когда работаешь над kanban-задачей через MCP (т.е. знаешь её `taskId`), оставляй
комментарии через `pf_create_task_comment` на ключевых точках. Это превращает
карточку задачи в живой лог прогресса — юзер открывает её и видит контекст без
расспросов в чате.

**Когда комментировать:**

- **Старт работы** — «беру в работу, план: X, Y, Z». Один раз когда подхватил задачу.
- **Важное решение** — выбор между подходами, изменение scope, отказ от чего-то. Один comment с why.
- **Blocker** — нужны уточнения, отсутствуют доступы, конфликт с другой задачей. Тэгай `@displayName` владельца — придёт notification.
- **PR/коммит** — «PR #N открыт, ждёт review» или «закоммитил `<sha>`, переношу в done».
- **Завершение** — «готово, обратите внимание на …» если есть что подсветить.

**Когда НЕ комментировать:**

- Каждый мелкий шаг («читаю файл», «бегу typecheck») — это шум.
- Self-talk / размышления вслух — это для CoT, не для kanban.
- Дублирование того что и так в commit-message.

**Стиль:** короткие сообщения 1–3 строки, business-tone. Markdown разрешён. Если в
тексте упоминаешь файлы — используй markdown-ссылки `[path/to/file.ts:L42](path/to/file.ts#L42)`,
юзер увидит их кликабельными в UI.

`pf_get_task` всегда возвращает thread — читай его перед стартом работы, там могут
быть прошлые попытки или уточнения от юзера.

## Правила для AI-ассистентов

1. **Чистая архитектура — не ритуал.** Перед тем как добавить код в `presentation/`,
   проверь: не нужно ли сначала ввести use-case в `application/`? Это бесплатно и
   защищает от смешения слоёв. ESLint и так упадёт на нарушении импорта.
2. **`presentation` НЕ импортирует из `infrastructure/mock/*` или `infrastructure/http/*`** —
   только через `useContainer()`. Никогда не пиши `import { MockProjectRepository } from
   '@/infrastructure/mock/...'` в компоненте.
3. **shadcn-компоненты — наши, в `components/ui/`.** Можно править. Обновления опциональны.
4. **Не править nginx-конфиги** — этим занимается админ FastPanel.
5. **Миграции — append-only.** Не редактируй уже выкаченные `db/0*_*.sql`,
   делай новый файл. MariaDB не понимает `INSERT ... AS new ...` — только `VALUES(col)`.
6. **`.env` — никогда не коммитим.** Шаблон — `.env.example`. Боевые значения
   для людей — в `docs/ONBOARDING.md` (репо приватный).
7. **Кириллица.** Все пользовательские строки — на русском. Технические комментарии,
   код, переменные, типы — на английском.
8. **Не вводить новые большие зависимости** (Next.js, NextAuth, TanStack Query, MUI,
   Chakra и т.д.) без обсуждения. Текущий стек выбирался сознательно.
9. **Если есть ProjectsFlow MCP** — перед коммитом синкай с kanban-задачами по ритуалу
   выше. Не молча: всегда подтверждай move у юзера через AskUserQuestion.

## LIVE-вкладка задачи (стрим действий Ralph-воркера)

Cursor-style лента действий воркера (`claude -p`) в реальном времени + replay при переоткрытии.
Сервер (Clean Arch, зеркало file-sync):

- **Данные:** миграция `db/053_live_sessions.sql` — таблица `live_sessions` (метаданные/статус/
  base_seq/стоимость/HEAD'ы) + nullable `task_progress_events.session_id`. События переиспользуют
  ту же append-only `task_progress_events` (UNIQUE(task_id, seq), идемпотентность через `ER_DUP_ENTRY`).
  Финальный git-дифф — это события `kind='file_diff'`/`diff_summary`, не отдельная таблица.
- **Слои:** `domain/live/{LiveSession,LiveEvent,LiveFileDiff,errors}`, `application/live/{LiveRepository(port),
  LiveService}`, `infrastructure/repositories/DrizzleLiveRepository` (`parseJsonCol`, DECIMAL/BIGINT → `Number()`),
  `infrastructure/realtime/LiveEventHub` (task-scoped firehose, зеркало `RealtimeHub`),
  `presentation/live/{agentRoutes,routes}`.
- **Ingest (Bearer, `requireDispatcherAccess`)** под `/api/agent`: `POST .../tasks/:t/live/sessions`,
  `.../sessions/:s/events` (батч ≤64), `.../sessions/:s/finish`.
- **Read (cookie, `requireProjectAccess('read_project')`)** под `/api/projects`:
  `GET .../live/sessions`, `.../sessions/:s/events?afterSeq=&limit=`, `.../sessions/:s/file-diffs`,
  `.../sessions/:s/stream` (SSE: replay из БД `seq>afterSeq` → subscribe `LiveEventHub(taskId)`;
  `event: live`/`live_end`; гейт доступа ДО `writeHead`; 410 если сессия завершилась >5 мин назад).
- **Realtime-бейдж 🔴:** `RealtimeEvent` union `live_session_changed`; `ProjectEventBroadcaster.broadcastLiveSessionChanged`
  фанаутит участникам на start/finish (лёгкое событие — НЕ firehose; полная лента только в открытую SSE-вкладку).
- **Startup-sweep:** `liveService.sweepStaleRunning()` переводит зависшие `running` (процесс упал) → `timeout`.
- Wiring — `index.ts` (`liveEventHub`/`liveService`), mounts — `presentation/http.ts`.

## Правка мобильной вёрстки / PWA под iPhone (standalone)

Сайт закрепляют как PWA на iPhone (`manifest.webmanifest` → `display: standalone`). В этом
режиме появляются safe-area-инсеты (вырез/home-indicator). Правила, чтобы вёрстка не «съезжала»:

- **`viewport-fit=cover`** уже стоит в `client/index.html` — без него `env(safe-area-inset-*)`
  всегда `0`. Safe-area доступна как `env(safe-area-inset-top|bottom|left|right)`.
- **НИКОГДА не сочетай фиксированную высоту (`h-14`, `h-12`…) с `pb-[env(safe-area-inset-*)]`
  на одном элементе.** При глобальном `box-sizing: border-box` (Tailwind) паддинг съедает
  высоту изнутри и контент поджимается — особенно нижний таб-бар над home-indicator (инсет
  ~34px «откусывает» от 56px бара, иконки обрезаются). Используй `min-h-*` + паддинг (высота
  растёт ПОД safe-area), а не `h-*`.
- Высота вьюпорта — `h-dvh`/`dvh`, не `vh` (на iOS `vh` не учитывает динамические бары Safari).
- Плавающие элементы над нижним таб-баром поднимай на
  `bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))]` (паттерн уже в `TaskComposer`/`BulkActionBar`).
- Ширины адаптивной вёрстки вяжи на `vw`/`min-w-0`/`max-w-*`, а не на фикс-px — тогда работает
  и на экранах уже iPhone XS (≤375px) вплоть до 320px. Десктоп-поведение — под брейкпоинтом `sm:`.
- Проверять в Safari → «Добавить на экран Домой» (реальный standalone) ИЛИ DevTools responsive
  на 320/375/414px. Помни про нижний инсет ~34px на моделях с home-indicator.

## Типовые проблемы

| Симптом | Решение |
| --- | --- |
| ESLint падает с `Dependency not allowed` | нарушено правило слоёв. См. секцию «Архитектура client/». |
| `Cannot find module '@/...'` в TS | проверь `client/tsconfig.app.json` → `paths` и `client/vite.config.ts` → `resolve.alias`. |
| `Access denied ... @'127.0.0.1'` на сервере | юзер ходит только через сокет — в `.env` нужен `DB_SOCKET=/run/mysqld/mysqld.sock`. |
| PM2 не видит env-переменные | `ecosystem.config.cjs` использует `--env-file=.env`. Убедись, что `.env` лежит в `DEPLOY_PATH`. |
| 502 от nginx | `pm2 ls` на сервере → если процесс мёртв, `pm2 logs projectsflow` покажет причину. |
| Тёмная тема мерцает белым на загрузке | проверь блокирующий FOUC-скрипт в `client/index.html` (выполняется до React). |
