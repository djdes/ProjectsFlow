# ProjectsFlow — История проектов

Лендинг с живой хроникой проектов, тянет данные из MySQL.
**Стек:** Node.js 22 · Express · mysql2 · TypeScript · Vite · MariaDB 10.11.
**Хостинг:** FastPanel на projectsflow.ru, проксируется nginx → PM2 → Express.

```text
ProjectsFlow/
├── client/                # Vite + TS + vanilla DOM
│   ├── src/main.ts        # рендер страницы и фетч /api/projects
│   ├── src/styles.css     # editorial × constructivist стиль
│   └── index.html
├── server/                # Express + mysql2 (TS)
│   ├── src/index.ts       # /api/health, /api/projects, статика прода
│   └── src/db.ts          # pool + fetchProjects()
├── db/                    # SQL миграции (прогоняются по алфавиту)
│   ├── 001_init.sql
│   └── 002_seed.sql
├── scripts/
│   ├── migrate.mjs        # npm run db:migrate
│   ├── seed.mjs           # npm run db:seed
│   └── deploy.mjs         # npm run deploy
├── ecosystem.config.cjs   # PM2 (запускается на сервере)
├── .env.example           # шаблон → скопировать в .env
└── package.json           # npm workspaces (client + server)
```

## Быстрый старт (с нуля, за 60 секунд)

```bash
cp .env.example .env       # вписать DB_* и SSH_* — см. секрет-менеджер
npm install                # установит client + server через workspaces
npm run dev                # клиент :5173, API :4317 (proxy /api → 4317)
```

Открыть <http://localhost:5173/>. Если БД пустая — `npm run db:seed`.

## Команды

| Что нужно | Команда |
| --- | --- |
| Поднять dev (Vite + tsx watch) | `npm run dev` |
| Собрать прод-артефакты | `npm run build` |
| Запустить прод локально | `NODE_ENV=production npm start` |
| Применить миграции | `npm run db:migrate` |
| Залить сид | `npm run db:seed` |
| Задеплоить на projectsflow.ru | `npm run deploy` |

## Полный гайд для следующего разработчика

- **[docs/ONBOARDING.md](docs/ONBOARDING.md)** — доступы (SSH, MySQL, git),
  локальная разработка, деплой, прод-окружение, типовые проблемы. Начни отсюда.
- **[CLAUDE.md](CLAUDE.md)** — короткие правила работы в репозитории
  (для людей и AI-ассистентов).

> `.env` в git не лежит. Боевые креды — в `docs/ONBOARDING.md`; репозиторий
> приватный, держим его таким.
