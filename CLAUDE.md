# CLAUDE.md — правила работы в репозитории ProjectsFlow

Этот файл читают AI-ассистенты (Claude Code, Copilot, и т.д.) и любой
новый разработчик. Он короткий — не разрастаемся.

> **Доступы, git, деплой, прод-окружение целиком** — в [docs/ONBOARDING.md](docs/ONBOARDING.md).
> Этот файл — только короткие правила работы. Не дублируй сюда креды.

## Контекст проекта

- **Что это.** Платформа управления проектами (сайты, ПО и т.д.). Multi-tenant SaaS
  в планах; собираем поэтапно. Дизайн-доки лежат в [docs/superpowers/specs/](docs/superpowers/specs/).
- **Где живёт.** FastPanel на VPS `projectsflow.ru` (Azure Ubuntu 24.04).
  Код приложения: `/var/www/projectsflow/data/www/projectsflow.ru/`.
- **Топология доменов (план):** `projectsflow.ru` → лендинг (статика, Astro),
  `app.projectsflow.ru` → платформа (Node + client SPA). Кука сессии — `domain=.projectsflow.ru`.

## Стек

- **Node.js 22 LTS** (на сервере через nvm, см. `.nvmrc`).
- **Express 4** + **Drizzle ORM** + **mysql2/promise** на бэке. ESM, TypeScript.
- **Vite + React 19 + TypeScript + Tailwind + shadcn/ui** на фронте платформы (`client/`).
- **Astro 5 + React islands + Tailwind 3** на лендинге (`landing/`).
  3D-эффекты — `@react-three/fiber` + `drei`, lazy через `client:idle`.
- **MariaDB 10.11** (совместима с MySQL 8). Кодировка `utf8mb4`.
- **Auth: magic link only.** Без паролей. Письма шлёт `nodemailer` через SMTP FastPanel.
  В dev — `ConsoleEmailSender` печатает ссылку в stdout.
- **PM2** для процесса на сервере (`ecosystem.config.cjs`).
- **nginx** (FastPanel): `projectsflow.ru` → статика лендинга, `app.projectsflow.ru` → reverse proxy `127.0.0.1:4317`.

Next.js, NextAuth, RSC, Server Actions — **не используем**. Решение зафиксировано
в брейншторме (см. `docs/superpowers/specs/2026-05-14-platform-ui-skeleton-design.md`,
секция 1): чистая граница client↔server проще поддерживает Clean Architecture.

## Архитектура

### `client/` и `server/` — Clean Architecture (4 слоя)

```
client/src/                          server/src/
├── domain/                          ├── domain/         ← entities, value objects. 0 deps
├── application/                     ├── application/    ← ports + use-cases. Зависит только от domain
├── infrastructure/                  ├── infrastructure/ ← адаптеры (drizzle, github, smtp). Реализует порты
│   ├── di/container.tsx (мост)      └── presentation/   ← Express routes, middleware, http server
│   └── http/                            (DI собирается в src/index.ts — composition root)
├── presentation/                    
├── components/ui/                   
├── lib/                             
└── styles/                          
```

Правила импорта (на клиенте защищены `eslint-plugin-boundaries` в `client/eslint.config.js`):

| Слой | Импортирует из |
|---|---|
| `domain` | — |
| `application` | `domain` |
| `infrastructure` | `domain`, `application` |
| `presentation` | `domain`, `application`, `lib/`, `components/ui/` |

`presentation` НЕ импортирует из `infrastructure/http/*` напрямую — только через
DI-контейнер `infrastructure/di/container.tsx` (singleton на уровне модуля).

При добавлении новой фичи: сначала domain → application (порт + use-case) → infrastructure (адаптер)
→ UI. Не наоборот.

### `landing/` — Astro, без Clean Architecture

Лендинг — маркетинг-страница без домена и юзкейсов. Сюда Clean Architecture не тащим —
это плоский набор `.astro`-шаблонов + React-острова (`HeroScene.tsx`, `EmailForm.tsx`).
Если островов станет много и появятся общие use-case'ы — пересмотрим.

## Структура и где что менять

- **Новый shadcn-компонент** → `npx shadcn@latest add <name>` (положит в `client/src/components/ui/`).
- **Новая страница платформы** → компонент в `client/src/presentation/pages/`, маршрут в `presentation/app/routes.tsx`.
- **Новый use-case (client)** → класс в `client/src/application/<feature>/<UseCase>.ts`, регистрация в `container.tsx`.
- **Новый use-case (server)** → класс в `server/src/application/<feature>/<UseCase>.ts`, инстанцирование в `server/src/index.ts`.
- **Новый HTTP-роут (server)** → файл в `server/src/presentation/<feature>/routes.ts`, маунт в `server/src/presentation/http.ts`.
- **Новая Drizzle-таблица** → описание в `server/src/infrastructure/db/schema.ts` + SQL-миграция в `db/00N_*.sql`.
- **Новая секция лендинга** → `.astro`-компонент в `landing/src/components/`, рендер в `landing/src/pages/index.astro`.
- **Дизайн-токены платформы** — CSS-переменные в `client/src/styles/globals.css`, Tailwind-маппинг в `client/tailwind.config.ts`.
- **Дизайн-токены лендинга** — палитра в `landing/tailwind.config.mjs` (`ink-*`, `accent`), CSS — `landing/src/styles/globals.css`.
- **Миграции БД** — новый файл `db/00N_*.sql` (append-only, MariaDB-совместимый синтаксис).

## Auth: magic link

Поток:
1. Юзер вводит email на лендинге (`landing/src/components/EmailForm.tsx`) или `/login` платформы.
2. Сервер: `RequestMagicLink` создаёт токен (32 random bytes → base64url, в БД хранится только SHA-256),
   шлёт письмо со ссылкой `APP_URL/auth/magic/consume?token=...`.
3. Юзер кликает → React-страница `MagicConsumePage` POST'ит токен в `/api/auth/magic/consume`.
4. Сервер: `ConsumeMagicLink` валидирует токен (не истёк, не использован), создаёт юзера если первый раз,
   ставит cookie сессии (`domain=.projectsflow.ru` в проде), редиректит на `/`.

Куда смотреть:
- Use-cases: `server/src/application/auth/RequestMagicLink.ts`, `ConsumeMagicLink.ts`.
- Email-адаптеры: `server/src/infrastructure/email/NodemailerEmailSender.ts` (prod), `ConsoleEmailSender.ts` (dev).
- Rate limit: `MAGIC_RATE_LIMIT_*` env vars, 5 запросов / 10 мин на email по умолчанию.
- TTL ссылки: `MAGIC_TOKEN_TTL_MIN`, дефолт 15 мин.

В dev (без SMTP) сервер стартует с `ConsoleEmailSender` и печатает ссылку в лог. Endpoint
`/api/auth/magic/request` в dev возвращает `devMagicUrl` прямо в ответе — лендинг и `/login`
показывают её под формой.

## Переменные окружения

Файл `.env` (НЕ коммитим, шаблон — `.env.example`).

| Группа | Переменные | Зачем |
| --- | --- | --- |
| App | `NODE_ENV`, `PORT`, `APP_URL`, `BRAND_NAME` | базовая конфигурация |
| CORS | `CORS_ORIGINS` | список origin'ов для landing↔api запросов |
| Session | `SESSION_COOKIE_NAME`, `SESSION_TTL_DAYS`, `SESSION_COOKIE_DOMAIN` | в проде domain `.projectsflow.ru` |
| Magic | `MAGIC_TOKEN_TTL_MIN`, `MAGIC_RATE_LIMIT_*` | поведение magic-link auth |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | в проде обязательны |
| DB | `DATABASE_URL` (dev), `DB_SOCKET` (prod) | подключение Drizzle |
| Landing build | `PUBLIC_API_BASE_URL`, `PUBLIC_APP_URL` | прокидываются в браузер через Astro |
| GitHub OAuth | `GITHUB_CLIENT_ID` | device flow для интеграции |
| Secrets vault | `SECRETS_MASTER_KEY` | AES-256-GCM для хранилища секретов |
| SSH/Deploy | `SSH_*`, `DEPLOY_PATH`, `LANDING_DEPLOY_PATH` | `scripts/deploy.mjs` |

Если задан `DB_SOCKET` — код использует unix-сокет, игнорирует `DB_HOST/DB_PORT`.
Боевые значения — в [docs/ONBOARDING.md](docs/ONBOARDING.md), раздел 1.

## npm-скрипты (из корня)

```bash
npm run dev            # одновременно client (:5173) + server (:4317) + landing (:4321)
npm run dev:client     # только Vite (платформа)
npm run dev:server     # только Express
npm run dev:landing    # только Astro (лендинг)
npm run build          # сборка всех трёх workspaces
npm run typecheck      # tsc --noEmit в client/
npm run lint           # eslint в client/
npm run db:migrate     # node scripts/migrate.mjs
npm run deploy         # node scripts/deploy.mjs
```

## Деплой

```bash
npm run deploy
```

`scripts/deploy.mjs` собирает client + landing + server, пакует в два tarball'а
(`app.tar.gz` для платформы, `landing.tar.gz` для статики лендинга), загружает их
на сервер в `DEPLOY_PATH` и `LANDING_DEPLOY_PATH` соответственно, прогоняет миграции,
рестартит PM2.

**nginx-конфиг** (FastPanel) — отдельная задача админа: два vhost'а, `projectsflow.ru`
раздаёт статику из `LANDING_DEPLOY_PATH`, `app.projectsflow.ru` — reverse proxy на `127.0.0.1:4317`.

## SSH / Git / доступы

Хост `projectsflow.ru`, юзер `projectsflow`. Порт `22` изнутри LAN, `50222` из интернета.
Bare repo: `/var/www/projectsflow/data/git/projectsflow.git`, ветка `main`.
Полные URL, пароли — [docs/ONBOARDING.md](docs/ONBOARDING.md).

Workflow: фича → ветка → merge в `main` → `npm run deploy`.

## Правила для AI-ассистентов

1. **Чистая архитектура — не ритуал.** Перед тем как добавить код в `presentation/`,
   проверь: не нужно ли сначала ввести use-case в `application/`? Это бесплатно и
   защищает от смешения слоёв. ESLint и так упадёт на нарушении импорта.
2. **`presentation` НЕ импортирует из `infrastructure/http/*`** —
   только через `useContainer()` (на клиенте) или через DI в `server/src/index.ts` (на бэке).
3. **shadcn-компоненты — наши, в `client/src/components/ui/`.** Можно править. Обновления опциональны.
4. **Лендинг (`landing/`) — без Clean Architecture.** Это маркетинг-страница, плоский Astro+islands.
   Не пытайся затащить туда domain/application — это будут пустые папки.
5. **Не править nginx-конфиги** — этим занимается админ FastPanel.
6. **Миграции — append-only.** Не редактируй уже выкаченные `db/0*_*.sql`,
   делай новый файл. MariaDB не понимает `INSERT ... AS new ...` — только `VALUES(col)`.
7. **`.env` — никогда не коммитим.** Шаблон — `.env.example`. Боевые значения
   для людей — в `docs/ONBOARDING.md` (репо приватный).
8. **Кириллица.** Все пользовательские строки — на русском. Технические комментарии,
   код, переменные, типы — на английском.
9. **Auth — magic link, точка.** Не добавляй password-flow, OAuth-signin (кроме уже подключённого
   GitHub device flow для KB-интеграции), email-verification — это сознательно вырезано.
10. **Не вводить новые большие зависимости** (Next.js, NextAuth, TanStack Query, MUI, и т.д.)
    без обсуждения.

## Типовые проблемы

| Симптом | Решение |
| --- | --- |
| ESLint падает с `Dependency not allowed` | нарушено правило слоёв. См. «Архитектура» выше. |
| `Cannot find module '@/...'` в TS | проверь `client/tsconfig.app.json` → `paths` и `client/vite.config.ts` → `resolve.alias`. |
| `Access denied ... @'127.0.0.1'` на сервере | юзер ходит только через сокет — в `.env` нужен `DB_SOCKET=/run/mysqld/mysqld.sock`. |
| PM2 не видит env-переменные | `ecosystem.config.cjs` использует `--env-file=.env`. Убедись, что `.env` лежит в `DEPLOY_PATH`. |
| 502 от nginx | `pm2 ls` на сервере → если процесс мёртв, `pm2 logs projectsflow` покажет причину. |
| Magic link не приходит | проверь `[email:...]` строки в `pm2 logs`. В dev — печатается в stdout. В prod — SMTP-креды в `.env`. |
| CORS-ошибка на лендинге | добавь origin в `CORS_ORIGINS` в `.env`, рестарт сервера. |
| Сессия не подхватывается на `app.projectsflow.ru` после клика по magic-link | проверь `SESSION_COOKIE_DOMAIN=.projectsflow.ru` в проде. |
| Тёмная тема мерцает белым на загрузке | проверь блокирующий FOUC-скрипт в `client/index.html`. |
| Astro: `Cannot find package 'three'` | `npm install` в корне — `landing/` подцепится через workspaces. |
