# ONBOARDING — ProjectsFlow

> Полный пакет для нового разработчика: доступы, git, локальная разработка, деплой.
> **ВНИМАНИЕ:** файл содержит боевые пароли. Репозиторий обязан оставаться приватным.
> Если проект уходит «наружу» — вынеси креды в секрет-менеджер и вычисти этот файл из истории git.

Проект: **ProjectsFlow** — платформа управления проектами + маркетинг-лендинг.

Топология (план):
- `projectsflow.ru/` → лендинг (статика Astro, раздаёт nginx)
- `app.projectsflow.ru/` → платформа (Node 4317, reverse proxy через nginx)

Стек: Node.js 22 · Express · Drizzle ORM · mysql2 · TypeScript · Vite + React 19 · Astro 5 ·
MariaDB 10.11 · PM2 · nginx (FastPanel) · nodemailer SMTP · @react-three/fiber.

Auth: **magic link** (без паролей). См. CLAUDE.md → секция «Auth: magic link».

---

## 1. Доступы

### SSH

| Параметр | Значение |
| --- | --- |
| Хост | `projectsflow.ru` |
| Пользователь | `projectsflow` |
| Пароль | `DWjrfrE8QSLk6opq!` |
| Порт (внутри LAN / с самого сервера) | `22` |
| Порт (из интернета и для git) | `50222` |
| Домашняя директория | `/var/www/projectsflow/data` |

```bash
# из интернета
ssh -p 50222 projectsflow@projectsflow.ru
# если ты внутри той же сети (LAN 192.168.33.0/24)
ssh -p 22 projectsflow@projectsflow.ru
```

Windows + PuTTY:

```powershell
plink -ssh -P 50222 -pw "DWjrfrE8QSLk6opq!" projectsflow@projectsflow.ru
```

> Рекомендация: добавь свой публичный ключ в `~/.ssh/authorized_keys` на сервере
> и перестань возить пароль в командах.

### MySQL / MariaDB

| Параметр | Значение |
| --- | --- |
| СУБД | MariaDB 10.11 |
| База | `projectsflow` |
| Пользователь | `projectsflow` |
| Пароль | `DWjrfrE8QSLk6opq!` |
| Порт TCP | `3306` |
| Unix-socket (на сервере) | `/run/mysqld/mysqld.sock` |

**Важно:** пользователь `projectsflow` на сервере ходит в БД **только через unix-socket**
(`projectsflow@localhost`), TCP по `127.0.0.1` ему закрыт. Поэтому на сервере в `.env`
стоит `DB_SOCKET=/run/mysqld/mysqld.sock` — код это понимает и использует сокет.

Удалённое TCP-подключение с рабочей станции — на момент написания **не открыто**
(`Access denied for user 'projectsflow'@'<твой ip>'`). Варианты:
- работать с БД через SSH на сервере (миграции так и гоняются — см. деплой);
- попросить хостера/админа выдать грант `projectsflow'@'<твой ip>'`;
- прокинуть туннель: `ssh -p 50222 -L 3306:127.0.0.1:3306 projectsflow@projectsflow.ru`
  — но и тут TCP-доступ упрётся в тот же грант, нужен `@'127.0.0.1'`.

### Git

| Параметр | Значение |
| --- | --- |
| Bare-репозиторий | `/var/www/projectsflow/data/git/projectsflow.git` |
| URL (из интернета) | `ssh://projectsflow@projectsflow.ru:50222/var/www/projectsflow/data/git/projectsflow.git` |
| URL (изнутри LAN) | `ssh://projectsflow@projectsflow.ru:22/var/www/projectsflow/data/git/projectsflow.git` |
| Основная ветка | `main` |

```bash
git clone ssh://projectsflow@projectsflow.ru:50222/var/www/projectsflow/data/git/projectsflow.git
```

---

## 2. Локальная разработка

Нужно: Node.js ≥ 20 (лучше 22, см. `.nvmrc`), git. Для деплоя — PuTTY suite (`plink`, `pscp`).

```bash
git clone <url-выше> ProjectsFlow
cd ProjectsFlow
cp .env.example .env          # заполнить значения — см. .env.example
npm install                   # ставит client + server + landing (npm workspaces)
npm run dev                   # параллельно: client :5173, server :4317, landing :4321
```

Что где открыть:
- <http://localhost:5173/> — платформа (React SPA, `/login` → magic link)
- <http://localhost:4321/> — лендинг (Astro, hero с 3D, email-форма)
- <http://localhost:4317/api/health> — здоровье API

### Magic link в dev

SMTP в dev не настроен — `ConsoleEmailSender` печатает ссылку в stdout сервера.
Plus endpoint `/api/auth/magic/request` в dev-режиме возвращает `devMagicUrl` прямо
в JSON-ответе, и лендинг + `/login` показывают её под формой. Просто кликни.

### Локальная БД

На дев-машине должен стоять локальный MySQL/MariaDB. Конфиг в `.env`:

```
DATABASE_URL=mysql://projectsflow:<local_pw>@127.0.0.1:3306/projectsflow
DB_HOST=127.0.0.1
DB_USER=projectsflow
DB_PASSWORD=<local_pw>
DB_NAME=projectsflow
```

Прогон миграций: `npm run db:migrate`. Прод-миграции прогоняет `scripts/deploy.mjs`
на сервере (через `node --env-file=.env scripts/migrate.mjs`).

---

## 3. Структура

```text
ProjectsFlow/
├── client/                # Vite + React 19 + TS + Tailwind + shadcn/ui — платформа (SPA)
│   └── src/{domain,application,infrastructure,presentation}/   # Clean Architecture
├── server/                # Express 4 + Drizzle + mysql2 (TS, ESM) — API
│   ├── src/application/auth/{RequestMagicLink,ConsumeMagicLink}.ts
│   ├── src/infrastructure/email/{Nodemailer,Console}EmailSender.ts
│   └── src/index.ts       # composition root (DI)
├── landing/               # Astro 5 + React islands + Tailwind 3 — маркетинг-лендинг
│   ├── src/pages/index.astro
│   └── src/components/{Hero,HeroScene,EmailForm,…}
├── db/                    # SQL-миграции, прогон по алфавиту, append-only
│   ├── 001_init.sql
│   ├── 002_platform_init.sql
│   └── 003_magic_link_auth.sql
├── scripts/
│   ├── migrate.mjs        # npm run db:migrate
│   └── deploy.mjs         # npm run deploy
├── ecosystem.config.cjs   # PM2-конфиг (исполняется на сервере)
├── .env / .env.example    # креды (.env в .gitignore)
└── package.json           # npm workspaces: client, server, landing
```

---

## 4. Деплой

Одной командой с рабочей станции (нужны `plink`/`pscp` в PATH):

```bash
npm run deploy
```

Что делает `scripts/deploy.mjs`:
1. `npm run build` — собирает `client/dist`, `landing/dist`, `server/dist`.
2. Пакует два tarball'а:
   - `app.tar.gz` (server/dist + client/dist + db + scripts) → `DEPLOY_PATH`
   - `landing.tar.gz` (содержимое landing/dist) → `LANDING_DEPLOY_PATH`
3. На сервере: распаковка, `npm install --omit=dev`, `node scripts/migrate.mjs`,
   `pm2 startOrReload ecosystem.config.cjs`, `pm2 save`.

Деплой использует `SSH_PORT_LOCAL` из `.env`. Если деплоишь из интернета —
поставь `SSH_PORT_LOCAL=50222`.

> `.env` на сервере **не перезаписывается деплоем** — он уже лежит на месте
> с боевыми значениями (`NODE_ENV=production`, `DB_SOCKET=...`, SMTP-креды).
> Менять руками при необходимости.

---

## 5. Прод-окружение

| Что | Где |
| --- | --- |
| Код платформы | `/var/www/projectsflow/data/www/projectsflow.ru/` |
| Статика лендинга | `/var/www/projectsflow/data/www/projectsflow.ru/landing/` (= `LANDING_DEPLOY_PATH`) |
| Node | 22.22.2 (через nvm: `~/.nvm`) |
| PM2 | 7.0.1, процесс `projectsflow`, режим `fork`, порт `4317` |
| Логи PM2 | `/var/www/projectsflow/data/logs/projectsflow.{out,err}.log` |
| nginx | FastPanel, два vhost'а (см. ниже) |
| SMTP | FastPanel mail server, ящик `noreply@projectsflow.ru` |

### nginx-конфиг (два vhost'а)

Делается админом FastPanel; здесь — что должно получиться по сути:

```
# projectsflow.ru → лендинг (статика)
server {
    server_name projectsflow.ru www.projectsflow.ru;
    root /var/www/projectsflow/data/www/projectsflow.ru/landing;
    try_files $uri $uri/ /index.html;
    # gzip/brotli + cache-headers для /_astro/*.{js,css}
}

# app.projectsflow.ru → платформа (Node)
server {
    server_name app.projectsflow.ru;
    location / {
        proxy_pass http://127.0.0.1:4317;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Node-сервер раздаёт ТОЛЬКО `/api/*`. SPA платформы (`client/dist`) проксируется
nginx'ом на `app.projectsflow.ru` — Express его НЕ раздаёт (static-handler из `http.ts` убран).
Для SPA-routes nginx должен делать `try_files $uri /index.html` в локации `/`.

### SMTP (FastPanel)

Лендинг и `/login` шлют magic-link через nodemailer. На сервере в `.env` должны быть:

```
SMTP_HOST=mail.projectsflow.ru     # или FastPanel-указанный hostname
SMTP_PORT=587
SMTP_SECURE=false                  # STARTTLS на 587, или true для 465
SMTP_USER=noreply@projectsflow.ru
SMTP_PASS=<пароль из FastPanel>
SMTP_FROM="ProjectsFlow <noreply@projectsflow.ru>"
```

Без этих переменных сервер **упадёт на старте в prod** (`NODE_ENV=production`).
В dev — фолбэк на `ConsoleEmailSender` (печатает письмо в stdout).

### Полезные команды на сервере

```bash
source ~/.nvm/nvm.sh && nvm use 22
pm2 ls                       # статус процесса
pm2 logs projectsflow        # живые логи
pm2 restart projectsflow     # рестарт
pm2 reload projectsflow      # zero-downtime перезапуск
curl -s http://127.0.0.1:4317/api/health   # пинг приложения
```

### Автозапуск после ребута (нужен sudo, делает админ)

PM2-процесс сохранён (`pm2 save`), но systemd-юнит для автостарта ещё не создан —
для этого нужен root. Команда (выполнить под админом FastPanel):

```bash
sudo env PATH=$PATH:/var/www/projectsflow/data/.nvm/versions/node/v22.22.2/bin \
  /var/www/projectsflow/data/.nvm/versions/node/v22.22.2/lib/node_modules/pm2/bin/pm2 \
  startup systemd -u projectsflow --hp /var/www/projectsflow/data
```

Пока юнит не создан — после перезагрузки сервера приложение нужно поднимать вручную:
`pm2 resurrect`.

---

## 6. База данных

- Schema-of-truth — Drizzle: `server/src/infrastructure/db/schema.ts`.
- SQL-миграции — `db/00N_*.sql`, **append-only**. Не редактируй уже выкаченные.
  Новый файл = `db/00N_<feature>.sql`.
- Текущие миграции:
  - `001_init.sql` — legacy (старая `projects` таблица лендинга, уже снесена в 002).
  - `002_platform_init.sql` — users + sessions + projects + user_github_tokens + secrets.
  - `003_magic_link_auth.sql` — drop `users.password_hash`, add `magic_tokens` для passwordless auth.
- MariaDB **не поддерживает** синтаксис `INSERT ... AS new ON DUPLICATE KEY UPDATE`
  (это MySQL 8.0.19+). Используй классический `VALUES(col)`.

```bash
# на сервере
mysql -u projectsflow -p'DWjrfrE8QSLk6opq!' projectsflow
```

---

## 7. Типовые проблемы

| Симптом | Причина / решение |
| --- | --- |
| `Access denied for user 'projectsflow'@'<ip>'` | Удалённый TCP к БД не открыт. Гоняй миграции на сервере (деплой это делает сам), либо проси грант. |
| `Access denied ... @'127.0.0.1'` на сервере | Юзер ходит только через сокет. В `.env` должен быть `DB_SOCKET=/run/mysqld/mysqld.sock`. |
| `npm run deploy` падает на `tar` | Нужен `tar` из Git for Windows или WSL. `pscp`/`plink` — из PuTTY suite, должны быть в PATH. |
| 502 от nginx на `app.projectsflow.ru` | `pm2 ls` → если процесс мёртв, `pm2 logs projectsflow`. |
| `projectsflow.ru` отдаёт 404 / чужой сайт | nginx vhost для лендинга не настроен. См. раздел 5, секция «nginx-конфиг». |
| Magic link не приходит | `pm2 logs projectsflow` — ищи `[email:...]`. В dev печатается в stdout. В prod проверь SMTP_*. |
| CORS-ошибка на лендинге | Добавь origin в `CORS_ORIGINS` в `.env`, рестарт сервера. |
| Кука сессии не подхватывается между landing и app | В prod нужен `SESSION_COOKIE_DOMAIN=.projectsflow.ru`. |
| Проверяешь curl-ом, видишь PHP | Резолвишь на `127.0.0.1:443` — это служебный listener. Публичный vhost на `192.168.33.3`. Тестируй `curl --resolve projectsflow.ru:443:192.168.33.3`. |
| После ребута сайт лёг | Автостарт PM2 не настроен (нет sudo). `pm2 resurrect` вручную или попроси админа про `pm2 startup` (см. раздел 5). |

---

## 8. Git workflow

- `main` — то, что на проде.
- Фича → ветка → (по возможности ревью) → merge в `main` → `npm run deploy`.
- Bare-репозиторий на сервере, второго remote (GitHub и т.п.) пока нет — добавь при необходимости.

---

См. также [CLAUDE.md](../CLAUDE.md) — короткие правила работы в репозитории (для людей и AI).
