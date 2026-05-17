# @projectsflow/mcp-server

MCP-сервер для [ProjectsFlow](https://projectsflow.ru) — даёт Claude Code и другим
MCP-клиентам доступ к credentials, хранящимся в vault'е проектов.

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

| Tool | Описание |
|---|---|
| `pf_list_projects` | Список проектов юзера (id, name, hasKb, gitRepoUrl) |
| `pf_list_credentials` | Список credential-файлов в проекте (slug, title, kind) |
| `pf_get_credential` | Полный credential с резолвленными секретами (plaintext) |

## Пример

```
You: deploy app to prod
Claude: I need to find deployment credentials. Let me check ProjectsFlow.
   [calls pf_list_projects → finds your project]
   [calls pf_list_credentials with projectId → finds "ssh-prod"]
   [calls pf_get_credential → asks you to approve]
You: approve
Claude: [receives plaintext: ssh_host, ssh_user, ssh_password]
   [runs deploy with the credentials]
```

## Revocation

Если токен скомпрометирован — отзови его в UI ProjectsFlow.
После revoke все запросы с этим токеном получают 401.

## Лицензия

MIT
