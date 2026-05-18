# @projectsflow/mcp-server

MCP-сервер для [ProjectsFlow](https://projectsflow.ru) — даёт Claude Code и другим
MCP-клиентам доступ к credentials и kanban-задачам проектов.

## Установка

```bash
# В Claude Code
claude mcp add projectsflow npx -- -y @projectsflow/mcp-server
```

## Настройка

Создай файл `~/.config/projectsflow/agent.json`:

```json
{
  "apiUrl": "https://projectsflow.ru/api",
  "token": "pfat_..."
}
```

Токен генерируется в UI ProjectsFlow: **Профиль → Доступ для агентов → Создать токен**.
Plaintext-значение токена показывается **один раз** при создании — сохрани сразу.

Альтернатива (через env vars):

```bash
export PROJECTSFLOW_API_URL="https://projectsflow.ru/api"
export PROJECTSFLOW_AGENT_TOKEN="pfat_..."
```

## Инструменты

### Чтение / vault

| Tool | Описание |
|---|---|
| `pf_list_projects` | Список проектов юзера (id, name, hasKb, gitRepoUrl) |
| `pf_list_credentials` | Список credential-файлов в проекте (slug, title, kind) |
| `pf_get_credential` | Полный credential с резолвленными секретами (plaintext) |

### Kanban / задачи

| Tool | Описание |
|---|---|
| `pf_list_tasks` | Список задач в проекте (id, title, description, status, position, commitCount) |
| `pf_move_task` | Перенести задачу на статус `todo` / `in_progress` / `done` (в конец колонки) |
| `pf_link_commit_to_task` | Привязать SHA коммита к задаче — auto-transition `todo → in_progress` на первом коммите |

## Пример: deploy с credentials

```
You: deploy app to prod
Claude: I need to find deployment credentials.
   [calls pf_list_projects → finds your project]
   [calls pf_list_credentials with projectId → finds "ssh-prod"]
   [calls pf_get_credential → asks you to approve]
You: approve
Claude: [receives plaintext: ssh_host, ssh_user, ssh_password]
   [runs deploy with the credentials]
```

## Пример: sync задач с коммитом

```
You: fix the kanban drag-drop bug we discussed
Claude: [implements fix, stages changes]
   [calls pf_list_tasks → sees "Fix kanban drag-drop on Safari" in todo]
   Looks like this matches task "Fix kanban drag-drop on Safari" (id=abc-123).
   Plan: commit → push → link to that task → move it to done. Confirm?
You: yes
Claude: [runs git commit + git push, gets SHA=a1b2c3d]
   [calls pf_link_commit_to_task → task auto-moves from todo to in_progress]
   [calls pf_move_task with targetStatus=done → task in done column]
   Done. Task linked + moved.
```

## Revocation

Если токен скомпрометирован — отзови его в UI ProjectsFlow.
После revoke все запросы с этим токеном получают 401.

## Лицензия

MIT
