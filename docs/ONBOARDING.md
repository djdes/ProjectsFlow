# ONBOARDING — ProjectsFlow

> Полный пакет для нового разработчика: доступы, git, локальная разработка, деплой.
> **ВНИМАНИЕ:** файл содержит боевые пароли. Репозиторий обязан оставаться приватным.
> Если проект уходит «наружу» — вынеси креды в секрет-менеджер и вычисти этот файл из истории git.

Проект: лендинг **«История проектов»** на `projectsflow.ru`.
Стек: Node.js 22 · Express · mysql2 · TypeScript · Vite · MariaDB 10.11 · PM2 · nginx (FastPanel).

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
cp .env.example .env          # заполнить значения — см. раздел 1
npm install                   # ставит client + server (npm workspaces)
npm run dev                   # Vite :5173, API :4317, /api проксируется на 4317
```

Открыть <http://localhost:5173/>.

### Локальная БД

**Правило: дев-машина НЕ ходит в прод-БД.** `.env` содержит только локальные
значения, прод-кред живут в `.env.prod` (gitignored, для ad-hoc CLI) и в
GitHub Actions secrets (для CI-деплоя).

На дев-машине должен стоять локальный MySQL/MariaDB. У текущего разработчика —
MySQL 9.6 на 127.0.0.1:3306, БД `projectsflow`, юзер `projectsflow` с правами
только на эту БД. Версия дрифтует с прод (MariaDB 10.11) — на текущем стеке
(utf8mb4, базовый SQL, без JSON) это работает, но для строгого соответствия —
поставить MariaDB 10.11 в Docker.

`.env` для локальной разработки:

```
NODE_ENV=development
PORT=4317

# DATABASE_URL приоритетнее DB_* (см. server/src/infrastructure/db/index.ts).
DATABASE_URL=mysql://projectsflow:<LOCAL_PASSWORD>@127.0.0.1:3306/projectsflow

# DB_* нужны для scripts/migrate.mjs (он не читает DATABASE_URL).
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=projectsflow
DB_PASSWORD=<LOCAL_PASSWORD>
DB_NAME=projectsflow

GITHUB_CLIENT_ID=Ov23liMlggU0i73dJ27a
SESSION_COOKIE_NAME=pf_session
SESSION_TTL_DAYS=30
```

> Раньше тут был `SECRETS_MASTER_KEY` (AES-GCM для секретов в KB-credential'ах).
> С миграции `006_secrets_drop_encryption.sql` секреты хранятся plaintext —
> ключа больше нет. Причина: ключ жил в `.env`, потеря/перезапись делала
> все credential'ы нерасшифровываемыми; для one-tenant платформы на собственном
> VPS такой риск не оправдан.

Прогон миграций: `npm run db:migrate`. Применённые трекаются в таблице
`_migrations`. Прод-миграции прогоняет CI на сервере (см. `.github/workflows/deploy.yml`).

Если нужно подключиться к прод-БД руками с дев-машины — `.env.prod` содержит
кред, гоняй mysql-клиент с явным `--host=projectsflow.ru`. Не подменяй `.env`.

---

## 3. Структура

```text
ProjectsFlow/
├── client/                # Vite + TS + vanilla DOM (лендинг)
│   ├── src/main.ts        # рендер + fetch /api/projects
│   ├── src/styles.css     # editorial × constructivist
│   └── index.html
├── server/                # Express + mysql2 (TS, ESM)
│   ├── src/index.ts       # /api/health, /api/projects, статика прода
│   └── src/db.ts          # пул соединений + fetchProjects()
├── db/                    # SQL-миграции, прогон по алфавиту, append-only
│   ├── 001_init.sql
│   └── 002_seed.sql
├── scripts/
│   ├── migrate.mjs        # npm run db:migrate
│   ├── seed.mjs           # npm run db:seed
│   └── deploy.mjs         # npm run deploy
├── ecosystem.config.cjs   # PM2-конфиг (исполняется на сервере)
├── .env / .env.example    # креды (.env в .gitignore)
└── package.json           # npm workspaces
```

---

## 4. Деплой

Одной командой с рабочей станции (нужны `plink`/`pscp` в PATH):

```bash
npm run deploy
```

Что делает `scripts/deploy.mjs`:
1. `npm run build` — собирает `client/dist` и `server/dist`.
2. Пакует `tar.gz`, заливает на сервер через `pscp`.
3. На сервере: распаковка, `npm install --omit=dev`, `node scripts/migrate.mjs`,
   `pm2 startOrReload ecosystem.config.cjs`, `pm2 save`.

Деплой использует `SSH_PORT_LOCAL` из `.env`. Если деплоишь из интернета —
поставь `SSH_PORT_LOCAL=50222`.

### Ручной деплой (если `npm run deploy` недоступен)

```bash
npm run build
tar -cf release.tar server/dist client/dist db scripts package.json server/package.json ecosystem.config.cjs
pscp -P 50222 -pw "..." release.tar projectsflow@projectsflow.ru:/var/www/projectsflow/data/www/projectsflow.ru/
ssh -p 50222 projectsflow@projectsflow.ru
# на сервере:
cd /var/www/projectsflow/data/www/projectsflow.ru
tar -xf release.tar && rm release.tar
source ~/.nvm/nvm.sh && nvm use 22
npm install --omit=dev
node --env-file=.env scripts/migrate.mjs
pm2 startOrReload ecosystem.config.cjs && pm2 save
```

> `.env` на сервере **не перезаписывается деплоем** — он уже лежит на месте
> с боевыми значениями (`NODE_ENV=production`, `DB_SOCKET=...`). Менять руками при необходимости.

---

## 5. Прод-окружение

| Что | Где |
| --- | --- |
| Код приложения | `/var/www/projectsflow/data/www/projectsflow.ru/` |
| Node | 22.22.2 (через nvm: `~/.nvm`) |
| PM2 | 7.0.1, процесс `projectsflow`, режим `fork`, порт `4317` |
| Логи PM2 | `/var/www/projectsflow/data/logs/projectsflow.{out,err}.log` |
| nginx | FastPanel, reverse proxy `projectsflow.ru` → `127.0.0.1:4317` |
| Публичный listener | `192.168.33.3:80` и `:443` |

Express в проде сам раздаёт статику из `client/dist` и отдаёт `index.html` на все
не-API маршруты, поэтому nginx достаточно просто проксировать весь трафик на `4317`.

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

- Схема — `db/001_init.sql`, сид — `db/002_seed.sql`. Миграции **append-only**:
  не редактируй уже выкаченные файлы, добавляй `db/00N_*.sql`.
- Сид идемпотентный (`ON DUPLICATE KEY UPDATE` по `slug`), можно гонять повторно.
- MariaDB **не поддерживает** синтаксис `INSERT ... AS new ON DUPLICATE KEY UPDATE`
  (это MySQL 8.0.19+). Используй классический `VALUES(col)`.
- Добавить проект в ленту: строка в `db/002_seed.sql` либо `INSERT` прямо в БД.
  Поле `status`: `live` / `archived` / `in-progress` / `hidden` (последний скрывает запись).

```bash
# на сервере
mysql -u projectsflow -p'DWjrfrE8QSLk6opq!' projectsflow
```

---

## 6.6 Коллаборация: email, real-time (SSE), root-admin

Эти фичи добавлены вместе (приглашения по почте, live-уведомления, git-collision,
admin-доступ). Нужны новые env-переменные (шаблон — `.env.example`):

| Переменная | Назначение |
| --- | --- |
| `APP_URL` | Базовый URL для accept-ссылок в письмах (локально `http://localhost:5173`). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | SMTP для invite-писем. Если `SMTP_HOST` пуст — письма логируются в консоль (dev-заглушка). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Сид root-админа (`scripts/seed-admin.mjs`). |

- **Root-admin.** Один пользователь с `users.is_admin=1` получает глобальный доступ ко
  всем проектам (через admin-bypass в `requireProjectAccess`) + раздел `/admin`
  (все проекты по владельцам, управление пользователями). Засидить/сбросить пароль:
  ```bash
  npm run db:migrate      # применит 016_users_is_admin + 017_project_join_requests
  npm run db:seed-admin    # создаст/обновит ADMIN_EMAIL с is_admin=1 (идемпотентно)
  ```
- **SSE (live-уведомления).** Эндпоинт `GET /api/notifications/stream` держит
  long-lived `text/event-stream`. **На проде nginx буферизует SSE по умолчанию** —
  события копятся и не доходят. Нужен (делает админ FastPanel) для этого location:
  ```nginx
  location /api/notifications/stream {
      proxy_pass http://127.0.0.1:4317;
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 1h;
  }
  ```
  В ответе уже стоит `X-Accel-Buffering: no` — если кастомный location не добавят,
  это всё равно отключит буферизацию на стандартном проксировании.

---

## 6.5 Agent runner локально (/loop)

ProjectsFlow умеет автоматически выполнять задачи через локальную Claude Code сессию.
Юзер кликает «Отдать агенту» в UI, далее локальный `/loop` подхватывает job и делает PR.
Архитектурное обоснование — `docs/superpowers/specs/2026-05-21-kanban-agent-runner-design.md`.

### Pre-requisites

- **Claude Code** (CLI или desktop), залогинен под Pro/Max подпиской: `claude login`.
- **`gh` CLI:** `gh auth login`.
- **Git + SSH key в GitHub** (если репо приватный — через SSH; либо `gh auth git-credential`).
- **MCP-token ProjectsFlow:** `npx -y @projectsflow/mcp-server@latest setup` — один раз создаст
  `~/.config/projectsflow/agent.json`.

### Workspace

Создай директорию-агрегатор и клонируй все репо к которым может прикасаться агент:

```bash
mkdir -p ~/agent-workspace && cd ~/agent-workspace
gh repo clone djdes/ProjectsFlow
gh repo clone djdes/OrdersFlow
# ... и так далее
```

### Slash-command

Положи в `~/.claude/commands/check-agent-queue.md` markdown-файл с детальным промптом для
каждого /loop-тика. Полный canonical-текст — в spec
[2026-05-21-kanban-agent-runner-design.md](superpowers/specs/2026-05-21-kanban-agent-runner-design.md)
секция § 9.3. Файл **не коммитится в repo проекта** — он живёт в твоей домашней Claude Code-конфигурации.

Этот же файл можно положить per-repo в `~/.claude/projects/<repoSlug>/commands/check-agent-queue.md` —
тогда команда видна только при работе в этом репо.

### Запуск

```bash
cd ~/agent-workspace
claude
> /loop 10m /check-agent-queue
```

`10m` — интервал между тиками. Меньше → быстрее реакция, но сжигается rate-limit подписки.
**10–15 минут — sweet spot.** Закрытие терминала = pause. Открыл снова и запустил — продолжается
с того же места (state в БД).

### Что произойдёт

Каждые 10 минут Claude:
1. Вызовет `pf_list_pending_agent_jobs` — список queued агенту job'ов по всем доступным проектам.
2. Если пусто — выйдет с одной строкой («ничего не делать»), не сжигая tool-budget.
3. Если есть — `pf_claim_agent_job(jobId)` (атомарно, конкуренция между двумя /loop-сессиями
   разрулится 409-ом на одной из них).
4. Прочитает task через `pf_get_task` (включая attachments и comments thread).
5. Сделает изменения в `~/agent-workspace/<repoSlug>/` — создаст branch, реализует, коммит.
6. `git push` + `gh pr create --draft`.
7. `pf_create_task_comment` со ссылкой на PR.
8. `pf_complete_agent_job(jobId, ok=true, prUrl=...)`.
9. Выйдет. Следующий тик повторится.

### Cancel-flow

Юзер может отменить через UI пока job в `queued` или `running`:
- Queued → cancelled молча, /loop её не подхватит.
- Running → /loop увидит 409 на `pf_complete_agent_job`, должен почистить локальный branch
  и не пушить PR (slash-command это обрабатывает).

### Что если что-то ломается

- **MCP-token revoke'нут** → следующий tool-call упадёт с 401. Юзер видит ошибку в Claude
  Code, переоткрывает токен через UI «Доступ для агентов».
- **`gh` или git auth слетел** → Claude увидит ошибку, оставит comment в task'е через
  `pf_create_task_comment` + `pf_complete_agent_job(ok=false, error=...)`.
- **/loop сам по себе** не имеет здоровья: если Claude Code зависнет — Ctrl-C, перезапустить.

---

## 6.7 Монитор серверов локально (monitor-collect.ps1)

Сбор метрик `remote`-серверов проектов (см. spec `2026-06-01-server-monitoring-design.md`).
Отдельный от dispatch процесс-сборщик в `C:\www\ralph`:

- `monitor-collect.ps1` — GET `/api/agent/monitoring/servers` → для каждого remote-сервера
  SSH-проба (`pm2 jlist` + `df` + `/proc/*` + хвост nginx-логов) → POST снимка в
  `/api/agent/projects/{id}/monitoring/snapshots`. `local`-серверы PF собирает сам (бэкенд
  читает свой хост) — сборщик их пропускает.
- **Предусловия:** OpenSSH-клиент (`ssh`) на машине сборщика; BatchMode SSH-ключ для
  `sshUser@host` каждого сервера (ключи живут ЗДЕСЬ, в PF не уходят); agent-токен владельца
  проекта в `mcp-projectsflow.json`.
- **Конфиг:** блок `monitoring` в `config.local.json` (`enabled` по умолчанию `false`,
  `intervalSeconds`, `sshClient`, `probeTimeoutSeconds`, `tailLines`, `tailMaxBytes`).
- **Запуск:** разово `pwsh -File C:\www\ralph\monitor-collect.ps1 -Once`; в цикле — без `-Once`.
  Логи — `C:\www\ralph\logs\monitor.log`. Тесты парсеров — `monitor-collect.tests.ps1` (Pester v5).
- **VPS самого PF** мониторить через сборщик НЕ нужно: добавьте в проект `local`-сервер — его
  читает бэкенд напрямую (env `MONITOR_LOCAL_COLLECT=on` если нужно форсить вне linux-prod).

---

## 7. Типовые проблемы

| Симптом | Причина / решение |
| --- | --- |
| `Access denied for user 'projectsflow'@'<ip>'` | Удалённый TCP к БД не открыт. Гоняй миграции на сервере (деплой это делает сам), либо проси грант. |
| `Access denied ... @'127.0.0.1'` на сервере | Юзер ходит только через сокет. В `.env` должен быть `DB_SOCKET=/run/mysqld/mysqld.sock`. |
| `npm run deploy` падает на `tar` | Нужен `tar` из Git for Windows или WSL. `pscp`/`plink` — из PuTTY suite, должны быть в PATH. |
| 502 от nginx | `pm2 ls` → если процесс мёртв, `pm2 logs projectsflow`. |
| На `projectsflow.ru` отдаётся чужой/PHP-сайт | nginx не переключён на reverse proxy. В FastPanel: тип сайта → Reverse Proxy → upstream `127.0.0.1:4317` → Apply. |
| Проверяешь curl-ом, видишь PHP | Резолвишь на `127.0.0.1:443` — это служебный listener. Публичный vhost на `192.168.33.3`. Тестируй `curl --resolve projectsflow.ru:443:192.168.33.3`. |
| После ребута сайт лёг | Автостарт PM2 не настроен (нет sudo). `pm2 resurrect` вручную или попроси админа про `pm2 startup` (см. раздел 5). |

---

## 8. Git workflow

- `main` — то, что на проде.
- Фича → ветка → (по возможности ревью) → merge в `main` → `npm run deploy`.
- Bare-репозиторий на сервере, второго remote (GitHub и т.п.) пока нет — добавь при необходимости.

---

См. также [CLAUDE.md](../CLAUDE.md) — короткие правила работы в репозитории (для людей и AI).
