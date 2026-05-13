# CLAUDE.md — правила работы в репозитории ProjectsFlow

Этот файл читают AI-ассистенты (Claude Code, Copilot, и т.д.) и любой
новый разработчик. Он короткий — не разрастаемся.

## Контекст проекта

- **Что это.** Лендинг `projectsflow.ru` — «История проектов». Список глав
  тянется из MySQL по `/api/projects`, рендерится на клиенте (Vite + TS).
- **Зачем.** Открытый архив инициатив команды с 2017 года.
- **Где живёт.** FastPanel на VPS `projectsflow.ru` (Azure Ubuntu 24.04).
  Docroot: `/var/www/projectsflow/data/www/projectsflow.ru/`.

## Стек — без отклонений

- **Node.js 22 LTS** (на сервере через nvm, см. `.nvmrc`).
- **Express 4** + **mysql2/promise** на бэке. ESM, TypeScript.
- **Vite + vanilla TypeScript** на фронте. Без React/Vue/Svelte —
  это лендинг, фреймворк не нужен.
- **MariaDB 10.11** (совместима с MySQL 8). Кодировка `utf8mb4`.
- **PM2** для процесса на сервере (`ecosystem.config.cjs`).
- **nginx** проксирует домен → `127.0.0.1:4317` (порт настраивает админ).

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
| `DB_HOST` | `projectsflow.ru` (если открыт remote) | `127.0.0.1` |
| `PORT` | `4317` | `4317` |
| `NODE_ENV` | `development` | `production` |

Креды лежат в секрет-менеджере команды (1Password / pass / etc).
Если их нет — спроси у тимлида.

## Деплой

```bash
npm run deploy
```

Что делает:
1. `npm run build` — собирает `client/dist` и `server/dist`.
2. Упаковывает в `tar.gz`, заливает на сервер через `pscp`.
3. На сервере: `npm install --omit=dev`, миграции, `pm2 reload`.

PM2 уже настроен (`pm2 save`), при ребуте сервер поднимется сам — если
админ запустил `pm2 startup` (это уже сделано при первом деплое).

**ВАЖНО:** перед деплоем убедись, что nginx-конфиг проксирует на
`PORT` из `.env`. Конфиг nginx правит админ FastPanel — мы туда не лезем.

## SSH / доступы

- Локальный порт (внутри LAN): `22`.
- Внешний порт (интернет, гит): `50222`.
- Хост: `projectsflow.ru`, юзер: `projectsflow`.
- Пароль — в `.env` (`SSH_PASSWORD`). Лучше — настроить ключи (`~/.ssh/authorized_keys`).

```powershell
# подключение из PowerShell (Windows + PuTTY suite)
plink -ssh -P 22 -pw "$env:SSH_PASSWORD" projectsflow@projectsflow.ru

# из внешки
plink -ssh -P 50222 -pw "$env:SSH_PASSWORD" projectsflow@projectsflow.ru
```

## Git workflow

- `main` — то, что на проде.
- Фича → ветка → PR → ревью → merge → `npm run deploy`.
- Bare repo на сервере: `/var/www/projectsflow/data/git/projectsflow.git`
  (`ssh://projectsflow@projectsflow.ru:50222/var/www/projectsflow/data/git/projectsflow.git`).
- Подразумевается публичное зеркало на GitHub — добавь второй remote если нужно.

## Правила для AI-ассистентов

1. **Не плодить файлы.** Это лендинг, не SaaS — `client/src/main.ts` сейчас рендерит
   всё одной функцией, и это нормально. Не разбивай на компоненты без причины.
2. **Не вводить React/Tailwind** без явной просьбы.
3. **Не править nginx-конфиги** — этим занимается админ FastPanel.
4. **Миграции — append-only.** Не редактируй уже выкаченные `db/0*_*.sql`,
   делай новый файл.
5. **`.env` — никогда не коммитим.** Если нужны значения — пиши в `.env.example`
   как пустые ключи или плейсхолдеры.
6. **Кириллица.** Все пользовательские строки — на русском. Технические комментарии
   и переменные — на английском.
7. **Стили.** Прежде чем тянуть новые шрифты/цвета, посмотри переменные в
   `:root` в `styles.css`. Палитра намеренно ограничена.

## Типовые проблемы

| Симптом | Решение |
| --- | --- |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` при сборке сервера | проверь, что у тебя Node 20+ (см. `.nvmrc`) |
| `Access denied for user 'projectsflow'@'<ip>'` | remote MySQL открыт не для твоего IP. Запусти миграции с сервера (`npm run deploy` это делает сам). |
| PM2 не видит env-переменные | `ecosystem.config.cjs` использует `--env-file=.env`. Убедись, что `.env` лежит в `DEPLOY_PATH`. |
| 502 от nginx | `pm2 ls` на сервере → если процесс мёртв, `pm2 logs projectsflow` покажет причину. |
