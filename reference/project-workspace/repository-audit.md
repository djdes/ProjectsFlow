# Аудит ProjectsFlow: Preview + Edit + Dashboard

## Текущая основа

- `ProjectPreview.tsx`: безопасный path, iframe, desktop/tablet/mobile, reload, loading/error.
- `ProjectDashboard.tsx`: Overview, project members, Data и Logs.
- `AppDataExplorer.tsx`: schema-aware CRUD, фильтры, сортировка, пагинация, row sheet и CRUD permissions.
- `AppLogsPanel.tsx`: app audit + project activity.
- Server app-backend: отдельный SQLite на проект, whitelist schema, `_users`, `_sessions`, `_audit_log`, quota.
- Site artifacts: атомарная публикация текущего каталога, SPA fallback и project result subdomain.
- Security: result iframe разрешён только платформенному origin; project permission checks существуют.
- AI: есть текстовые AI prompt jobs, но нет очереди точечных правок сайта.

## Обязательные архитектурные изменения

1. Preview Editor выделяется в самостоятельный application/infrastructure/presentation feature.
2. Между platform и result iframe используется только versioned `postMessage` bridge с точным origin, source и session nonce.
3. DOM-правки хранятся как очищенные patches, привязанные к route + artifact version + locator fingerprint.
4. AI edit — отдельная project-scoped job, потому что существующий text prompt job не знает selector/files/deployment.
5. Dashboard превращается в section registry; тяжёлые разделы не остаются в одном компоненте.
6. Viewer не получает app users, DB rows, secrets и runtime logs; серверные права не зависят от скрытых кнопок.
7. Published source/code показывается как escaped text; никаких `eval`, raw event attributes и произвольного JS.

## Файлы, которые не трогаем

- `primer/**` и пользовательские спецификации;
- существующие миграции `db/0*.sql` (только новая append-only migration);
- nginx/FastPanel конфигурацию;
- чужие untracked screenshots в корне.

## Проверки

- `npm run lint`
- `npm run typecheck`
- `npm test -w @projectsflow/client`
- `npm test -w @projectsflow/server`
- `npm run build`
- безопасный локальный CDP smoke в отдельной вкладке.
