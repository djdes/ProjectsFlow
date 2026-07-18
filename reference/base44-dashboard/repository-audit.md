# Сопоставление Dashboard с ProjectsFlow

## Уже есть в ProjectsFlow

- per-project SQLite app database;
- schema registry in MariaDB;
- schema-whitelisted CRUD;
- runtime auth and table access rules;
- 100 MB project quota;
- project subdomain resolution;
- worker provisioning and project-scoped agent access;
- project members, activity history, worker LIVE and result domain.

Текущий project-member UI показывает только статус app backend, использование квоты и имена таблиц. Полноценного админского Data explorer нет.

## Нужно добавить в первую очередь

1. Отдельную область `Preview / Dashboard` на странице проекта.
2. Data explorer: сущности, grid, pagination, typed filters/sort, row inspector, create/update/delete.
3. Отдельный member/admin API для Data explorer. Не использовать публичный runtime app key как административный доступ.
4. Проектные permission checks, audit log, optimistic concurrency и подтверждение удаления.
5. Secret/PII masking и ограничения на выгрузку.
6. Unified Logs: runtime приложения + действия воркера + публикация.
7. Users/Roles на основе участников пространства и проекта.
8. Publish health/security status.

## Второй этап

- custom domains;
- API docs/OpenAPI;
- authentication providers;
- test-data sandbox;
- безопасный act-as-user с обязательным аудитом.

## Пока не переносить

- social content generator;
- credits/upsell;
- встроенный code editor;
- agent builder;
- полный Canvas;
- cloning/templates;
- session recordings;
- настройки через AI-чат вместо явных форм.

Вывод: серверная основа для Data explorer уже в основном существует. Основная работа — безопасный административный API и качественная UI-оболочка, а не новая база данных с нуля.
