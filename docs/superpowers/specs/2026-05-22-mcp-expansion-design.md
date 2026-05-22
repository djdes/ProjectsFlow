# Дизайн: расширение MCP-сервера ProjectsFlow (+13 тулов)

Дата: 2026-05-22 · Статус: согласовано

## Context

У `@projectsflow/mcp-server` 20 тулов (проекты, KB/креды, задачи, agent-jobs, repo-sharing).
Пробелы: агент пишет KB-доки, но не читает их; нельзя править/удалять задачи; нет доступа к
финансам, поиску, участникам, коммитам. При этом **вся нужная бизнес-логика уже есть на сервере**
как use-case'ы — её просто не экспонировали в agent-API. Цель: дать агенту полноценный набор
операций, добавив тонкий слой «agent-route → ApiClient → MCP-tool» поверх существующих use-case'ов,
без новой бизнес-логики.

## Подход

**Тонкий слой экспонирования.** Для каждого нового тула: (1) роут в
[apiRoutes.ts](server/src/presentation/agent/apiRoutes.ts) (Bearer, `req.user.id`), вызывающий
**существующий** use-case; (2) метод в [ApiClient](mcp-server/src/api.ts); (3) определение тула +
zod + case в [index.ts](mcp-server/src/index.ts). Права уже проверяются `requireProjectAccess`
внутри use-case'ов — отдельной авторизации не добавляем. Версию MCP поднять `0.9.0 → 0.10.0`,
переопубликовать в npm.

## Новые тулы (13) и маппинг на существующие use-case'ы

| MCP-тул | Метод/роут (Bearer) | Use-case (есть) |
|---|---|---|
| `pf_list_kb_documents {projectId}` | `GET /agent/projects/:id/kb/documents` | `ListKbDocuments` (полный список, не только credentials) |
| `pf_read_kb_document {projectId, path}` | `GET /agent/projects/:id/kb/document?path=` | `GetKbDocument` |
| `pf_delete_kb_document {projectId, path}` | `DELETE /agent/projects/:id/kb/document?path=` | `DeleteKbDocument` |
| `pf_update_task {projectId, taskId, description}` | `PATCH /agent/projects/:id/tasks/:taskId` | `UpdateTask` |
| `pf_delete_task {projectId, taskId}` | `DELETE /agent/projects/:id/tasks/:taskId` | `DeleteTask` |
| `pf_list_commits {projectId, taskId}` | `GET /agent/projects/:id/tasks/:taskId/commits` | `ListTaskCommits` |
| `pf_sync_commits {projectId}` | `POST /agent/projects/:id/sync-commits` | `SyncTaskCommits` |
| `pf_get_project {projectId}` | `GET /agent/projects/:id` | `GetProject` |
| `pf_list_members {projectId}` | `GET /agent/projects/:id/members` | `ListProjectMembers` |
| `pf_search_tasks {query}` | `GET /agent/search/tasks?q=` | `SearchTasks` (scope: проекты юзера; admin — все) |
| `pf_get_finance {projectId}` | `GET /agent/projects/:id/finance` | `GetProjectFinance` (owner/visibility-gated) |
| `pf_add_expense {projectId, amountRubles, category, description?, incurredOn?}` | `POST /agent/projects/:id/finance/expenses` | `ManageProjectFinance.addExpense` (owner) |
| `pf_add_income {projectId, amountRubles, source?, receivedOn?}` | `POST /agent/projects/:id/finance/incomes` | `ManageProjectFinance.addIncome` (owner) |

## Решения по контракту

- **Деструктивные** (`pf_delete_task`, `pf_delete_kb_document`) — без встроенного подтверждения
  (по запросу пользователя). В описании тула — пометка «необратимо», но вызов не гейтится.
- **Деньги:** тулы принимают `amountRubles` (number, рубли) — дружелюбнее агенту; роут конвертирует
  в копейки `Math.round(rubles*100)` перед `ManageProjectFinance`. `pf_get_finance` возвращает суммы
  **в рублях** (`*Rubles`-поля, конвертация копейки→рубли в MCP-обёртке), плюс исходные `*Kopecks`
  для точности — единообразно по всем суммам сводки.
- **Даты** (`incurredOn`/`receivedOn`) — опциональны, дефолт «сегодня» (как в use-case по умолчанию).
- **KB path** — тот же формат, что у `pf_write_kb_document` (`^[a-z0-9_./-]+\.md$`).
- **DTO:** переиспользуем существующие DTO-функции agent-роутера (taskToDto, commitToDto и т.д.);
  для finance/members/kb-doc — компактные DTO (даты → ISO).
- **Финансы owner-only:** если токен-юзер не владелец — use-case вернёт 403; MCP отдаст ошибку
  (нормально). `pf_get_finance` дополнительно учитывает `finance_visibility`.

## Файлы

**Сервер:** [apiRoutes.ts](server/src/presentation/agent/apiRoutes.ts) (+13 роутов, +deps),
[http.ts](server/src/presentation/http.ts) (AppDeps.agent + проброс), [index.ts](server/src/index.ts)
(DI: переиспользовать уже созданные инстансы UpdateTask/DeleteTask/ListTaskCommits/SyncTaskCommits/
GetProject/ListProjectMembers/SearchTasks/GetProjectFinance/ManageProjectFinance — большинство уже
сконструированы для web/agent; недостающие добавить).
**MCP:** [api.ts](mcp-server/src/api.ts) (+13 методов + типы), [index.ts](mcp-server/src/index.ts)
(+13 TOOLS + zod + cases; версия 0.10.0), `package.json` версия, README/вступит. комментарий.

## YAGNI (не делаем)

employee CRUD, notifications, project archive/delete, credential update/delete, resolve
join-request (одобряет владелец на сайте), task attachments upload.

## Verification

- `npm run build:server` + сборка mcp — зелёное.
- Локальный boot (свободный порт) + Bearer-токен: каждый новый эндпоинт отвечает (а не 404).
- Вживую через обновлённый MCP (после publish + reload): прочитать KB-док после write; update/delete
  задачи; `pf_search_tasks` находит по тексту; `pf_get_finance` отдаёт P&L; `pf_add_expense`
  /`pf_add_income` появляются в сводке; `pf_list_members` отдаёт участников; `pf_list_commits`
  /`pf_sync_commits` работают на проекте с git.
- Деструктивные: `pf_delete_task` реально удаляет; `pf_delete_kb_document` убирает доку из KB.
- Republish `@projectsflow/mcp-server@0.10.0`.
