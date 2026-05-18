# @projectsflow/mcp-server

MCP-сервер для [ProjectsFlow](https://projectsflow.ru) — даёт Claude Code и другим
MCP-клиентам доступ к credentials и kanban-задачам проектов.

## Установка (рекомендуемый flow — device pairing, без копипасты токена)

**Шаг 1:** запусти setup в терминале — он откроет браузер и попросит подтвердить подключение:

```bash
npx -y @projectsflow/mcp-server@latest setup
```

Если ProjectsFlow живёт не на `projectsflow.ru`, передай свой apiUrl:

```bash
PROJECTSFLOW_API_URL=https://app.example.com/api npx -y @projectsflow/mcp-server@latest setup
```

Setup:
- выпишет на сервере pending device-code,
- откроет страницу `/device?code=ABCD-1234` в браузере,
- ты нажмёшь «Подключить» — agent-токен создаётся и автоматически сохраняется в `~/.config/projectsflow/agent.json`.

**Шаг 2:** зарегистрируй MCP в Claude Code:

```bash
claude mcp add --scope user projectsflow -- npx -y @projectsflow/mcp-server@latest
```

`--scope user` делает MCP видимым во всех проектах Claude Code (без него — только в проекте, откуда запустил команду).

## Альтернатива: env-vars без device flow

Если хочешь обойтись без браузера — создай токен в UI **Профиль → Доступ для агентов → Создать токен вручную**,
скопируй плейнтекст и передай его через `-e`:

```bash
claude mcp add --scope user projectsflow \
  -e PROJECTSFLOW_API_URL=https://projectsflow.ru/api \
  -e PROJECTSFLOW_AGENT_TOKEN=pfat_... \
  -- npx -y @projectsflow/mcp-server@latest
```

Этот вариант не пишет `~/.config/projectsflow/agent.json` — токен живёт прямо в Claude Code конфиге.

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
| `pf_list_tasks` | Список задач в проекте (id, title, description, status, position, commitCount, attachmentCount) |
| `pf_get_task` | Полный task + все вложения inline. Картинки — как `image`-блоки (агент их видит), остальное — как embedded resources. Используется когда у задачи `attachmentCount > 0`. |
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
