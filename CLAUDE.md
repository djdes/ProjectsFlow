# CLAUDE.md — правила работы в репозитории ProjectsFlow

Этот файл читают AI-ассистенты (Claude Code, Copilot, и т.д.) и любой
новый разработчик. Он короткий — не разрастаемся.

> **Доступы, git, деплой, прод-окружение целиком** — в [docs/ONBOARDING.md](docs/ONBOARDING.md).
> Этот файл — только короткие правила работы. Не дублируй сюда креды.

## Контекст проекта

- **Что это.** Лендинг `projectsflow.ru` — «История проектов». Список глав
  тянется из MySQL по `/api/projects`, рендерится на клиенте (Vite + TS).
- **Зачем.** Открытый архив инициатив команды с 2017 года.
- **Где живёт.** FastPanel на VPS `projectsflow.ru` (Azure Ubuntu 24.04).
  Код приложения: `/var/www/projectsflow/data/www/projectsflow.ru/`.
- **Статус.** В проде. nginx (FastPanel) проксирует домен → `127.0.0.1:4317`,
  приложение крутится под PM2 (`projectsflow`).

## Стек — без отклонений

- **Node.js 22 LTS** (на сервере через nvm, см. `.nvmrc`).
- **Express 4** + **mysql2/promise** на бэке. ESM, TypeScript.
- **Vite + vanilla TypeScript** на фронте. Без React/Vue/Svelte —
  это лендинг, фреймворк не нужен.
- **MariaDB 10.11** (совместима с MySQL 8). Кодировка `utf8mb4`.
- **PM2** для процесса на сервере (`ecosystem.config.cjs`).
- **nginx** (FastPanel, reverse proxy) проксирует домен → `127.0.0.1:4317`.
  Express в проде сам раздаёт `client/dist`, поэтому nginx просто шлёт весь
  трафик на порт.

Не вводи новые языки/фреймворки без обсуждения. Если хочется PHP/Python —
не надо, см. историю: пользователь явно просил «современный стек на Node».

## Структура и где что менять

- Новый проект в хронике → строка в `db/002_seed.sql` **или** `INSERT` в БД.
  Поле `status`: `live` / `archived` / `in-progress` / `hidden` (последний — скрыть).
- Схема меняется → новый файл `db/00N_*.sql`. Миграции идемпотентны и идут по алфавиту.
- Стили — `client/src/styles.css`. Эстетика **editorial × constructivist**:
  бумага `#f3ead3`, чернила `#0c0a08`, киноварь `#d94824`, Playfair + Manrope.
  Не уходи в общий «AI-look» (Inter + лиловые градиенты — нет).
- API → `server/src/index.ts`. Поля `Project` синхронизированы с `client/src/main.ts`.

## Переменные окружения

Файл `.env` (НЕ коммитим, шаблон — `.env.example`).
На сервере и локально файл одинаковой формы, разные значения:

| Переменная | Локально (с рабочей станции) | На сервере |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `PORT` | `4317` | `4317` |
| `DB_HOST` / `DB_PORT` | `projectsflow.ru` / `3306` (если открыт remote TCP) | — |
| `DB_SOCKET` | — | `/run/mysqld/mysqld.sock` (юзер ходит в БД только через сокет) |

Если задан `DB_SOCKET` — код использует unix-сокет и игнорирует `DB_HOST/DB_PORT`.
**Все значения кредов** — в [docs/ONBOARDING.md](docs/ONBOARDING.md), раздел 1.

## Деплой

```bash
npm run deploy
```

1. `npm run build` — собирает `client/dist` и `server/dist`.
2. Пакует в `tar`, заливает на сервер через `pscp`.
3. На сервере: распаковка, `npm install --omit=dev`, миграции, `pm2 startOrReload`.

`.env` на сервере деплоем не трогается. Подробности и ручной деплой —
в [docs/ONBOARDING.md](docs/ONBOARDING.md), раздел 4.

**Автостарт PM2 после ребута** требует sudo и пока не настроен — см.
ONBOARDING раздел 5. До этого после ребута: `pm2 resurrect`.

## SSH / Git / доступы

Хост `projectsflow.ru`, юзер `projectsflow`. Порт `22` изнутри LAN, `50222` из интернета.
Bare repo: `/var/www/projectsflow/data/git/projectsflow.git`, ветка `main`.
Полные URL, пароли, варианты подключения — [docs/ONBOARDING.md](docs/ONBOARDING.md).

Workflow: фича → ветка → merge в `main` → `npm run deploy`.

## Правила для AI-ассистентов

1. **Не плодить файлы.** Это лендинг, не SaaS — `client/src/main.ts` сейчас рендерит
   всё одной функцией, и это нормально. Не разбивай на компоненты без причины.
2. **Не вводить React/Tailwind** без явной просьбы.
3. **Не править nginx-конфиги** — этим занимается админ FastPanel.
4. **Миграции — append-only.** Не редактируй уже выкаченные `db/0*_*.sql`,
   делай новый файл. MariaDB не понимает `INSERT ... AS new ...` — только `VALUES(col)`.
5. **`.env` — никогда не коммитим.** Шаблон — `.env.example`. Боевые значения
   для людей — в `docs/ONBOARDING.md` (репо приватный).
6. **Кириллица.** Все пользовательские строки — на русском. Технические комментарии
   и переменные — на английском.
7. **Стили.** Прежде чем тянуть новые шрифты/цвета, посмотри переменные в
   `:root` в `styles.css`. Палитра намеренно ограничена.

## Типовые проблемы

| Симптом | Решение |
| --- | --- |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` при сборке сервера | проверь, что у тебя Node 20+ (см. `.nvmrc`) |
| `Access denied ... 'projectsflow'@'<ip>'` | remote MySQL TCP не открыт. Гоняй миграции с сервера (`npm run deploy` это делает сам). |
| `Access denied ... @'127.0.0.1'` на сервере | юзер ходит только через сокет — в `.env` нужен `DB_SOCKET=/run/mysqld/mysqld.sock`. |
| PM2 не видит env-переменные | `ecosystem.config.cjs` использует `--env-file=.env`. Убедись, что `.env` лежит в `DEPLOY_PATH`. |
| 502 от nginx | `pm2 ls` на сервере → если процесс мёртв, `pm2 logs projectsflow` покажет причину. |
| curl-ом видишь чужой PHP-сайт | резолвишь на `127.0.0.1:443` (служебный listener). Публичный vhost на `192.168.33.3`. |
