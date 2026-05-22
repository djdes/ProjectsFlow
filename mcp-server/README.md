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

### Проекты

| Tool | Описание |
|---|---|
| `pf_list_projects` | Список проектов юзера (id, name, status, hasKb, gitRepoUrl) |
| `pf_list_user_repos` | GitHub-репозитории юзера (fullName, htmlUrl, description, private, pushedAt). Зови перед `pf_create_project`, чтобы найти похожий по названию и предложить «подключить существующий». |
| `pf_create_project` | Создать проект. **Перед вызовом спроси у юзера про git** (см. ритуал ниже): `git.mode` = `none` / `connect` (привязать `gitRepoUrl`) / `create` (завести новый репо под GitHub-аккаунтом юзера, по умолчанию private). |
| `pf_update_project` | Переименовать проект и/или привязать git-репо (`name` и/или `gitRepoUrl`). Требует роль editor+. |

### Чтение / vault

| Tool | Описание |
|---|---|
| `pf_list_credentials` | Список credential-файлов в проекте (slug, title, kind) |
| `pf_get_credential` | Полный credential с резолвленными секретами (plaintext) |
| `pf_create_credential` | Создание нового credential'а: structured fields с явным `isSecret` → frontmatter + vault |

### Kanban / задачи

| Tool | Описание |
|---|---|
| `pf_list_tasks` | Список задач в проекте (id, title, description, status, position, commitCount, commentCount) |
| `pf_get_task` | Полный task + все вложения inline + thread комментариев. Картинки — как `image`-блоки (агент их видит), остальное — как embedded resources. Comments в текстовом мета-блоке, oldest-first. Вызывай всегда когда берёшь задачу в работу — комменты часто содержат уточнения. |
| `pf_create_task` | Создать новую задачу (по умолчанию падает в TODO в конец колонки) |
| `pf_create_task_comment` | Оставить комментарий на задаче — для прогресс-апдейтов по ходу работы. Mentions `@displayName` парсятся сервером, рассылаются notifications. Author = owner agent-токена. |
| `pf_move_task` | Перенести задачу на статус `todo` / `in_progress` / `done` (в конец колонки) |
| `pf_link_commit_to_task` | Привязать SHA коммита к задаче — auto-transition `todo → in_progress` на первом коммите |
| `pf_list_pending_agent_jobs` | Top-N queued agent-job'ов по всем проектам юзера. Для /loop-полла. |
| `pf_claim_agent_job` | Атомарный pickup queued→running. 409 если race. |
| `pf_complete_agent_job` | Финализация job: ok=true с prUrl или ok=false с error. |

### Произвольная запись в KB

| Tool | Описание |
|---|---|
| `pf_write_kb_document` | Создать или обновить любой `.md` в KB-репо. Для credential'ов предпочитай `pf_create_credential` — он сам делит на vault/frontmatter. |

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

## Пример: создание проекта (ритуал «спроси про git»)

Перед `pf_create_project` всегда уточняй про репозиторий — не создавай молча.

```
You: заведи проект «Лендинг Acme»
Claude: [calls pf_list_user_repos → видит репо "djdes/acme-landing"]
   Нашёл похожий репозиторий djdes/acme-landing. Как с git?
   1) подключить acme-landing  2) создать новый репо  3) без репо
You: подключай acme-landing
Claude: [calls pf_create_project name="Лендинг Acme",
           git={mode:"connect", gitRepoUrl:"https://github.com/djdes/acme-landing"}]
   Готово — проект создан и привязан к acme-landing.
```

Для нового репо: `git={mode:"create", repoName:"acme-landing", private:true}` — сервер
заведёт репозиторий под GitHub-аккаунтом юзера (тем, что подключён на сайте) и привяжет его.
Если у юзера не подключён GitHub — вернётся `409 github_not_connected`.

## Revocation

Если токен скомпрометирован — отзови его в UI ProjectsFlow.
После revoke все запросы с этим токеном получают 401.

## Лицензия

MIT
