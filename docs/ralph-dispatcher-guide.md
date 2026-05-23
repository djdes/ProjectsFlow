# Ralph-диспетчер ProjectsFlow

Этот документ — для **автономного агента (Ralph)**, который через MCP крутится в
`/loop` и сам выполняет задачи проектов. Если ты — обычная интерактивная сессия,
этот файл не для тебя — читай `CLAUDE.md` (ритуал коммита, синк kanban'а).

> «Ralph» — это паттерн автономного агента (см. [Geoffrey Huntley's «Ralph Wiggum
> Loop»](https://ghuntley.com/ralph/)). В контексте ProjectsFlow Ralph =
> MCP-инстанс с agent-токеном конкретного юзера, дежурящий на конкретной машине.

## Концепт

- **Один проект → один диспетчер** (юзер) или ручной режим.
- **Диспетчер** = член проекта, у которого есть хотя бы один активный agent-токен.
- На той машине, где этот юзер запустил MCP, и крутится Ralph для назначенных
  проектов.
- Если у юзера несколько машин с MCP — все они поллят, но **атомарный claim**
  (`pf_claim_agent_job`) гарантирует, что одну job сделает только одна машина.
- При revoke последнего активного токена юзера — сервер автоматически снимает
  его с роли диспетчера во всех проектах (некому работать).

## Setup (один раз на машину)

1. Создай agent-токен на сайте: `https://projectsflow.ru/profile` → «Agent
   tokens» → «Создать». Скопируй plaintext (показывается ОДИН раз).
2. Установи MCP в Claude Code:

   ```bash
   claude mcp add --scope user projectsflow \
     -e PROJECTSFLOW_API_URL=https://projectsflow.ru/api \
     -e PROJECTSFLOW_AGENT_TOKEN=pfat_... \
     -- npx -y @projectsflow/mcp-server@latest
   ```

   Альтернатива: `npx -y @projectsflow/mcp-server setup` для интерактивного
   device-flow без копи-пасты токена.

3. На сайте проекта (раздел **Ralph-диспетчер**) выбери себя диспетчером.
   Если в проекте только один кандидат с токеном — будет single-pick кнопка;
   если несколько — dropdown.

## Главный цикл Ralph'а

Псевдокод `/loop`-итерации:

```
loop:
  projects = pf_list_my_dispatched_projects()   # ← каждую итерацию
  if projects.length == 0:
      sleep(20m)   # делать нечего, не жжём ресурсы
      continue

  for p in projects:
      # 1. Сначала формальная очередь job'ов (юзер явно нажал «отправить агенту»):
      if p.queuedAgentJobCount > 0:
          jobs = pf_list_pending_agent_jobs(limit=10)
          job = jobs.find(j => j.projectId == p.id)
          if job:
              claimed = pf_claim_agent_job(job.id)         # ← атомарно
              if claimed:
                  work_on_job(claimed)
                  pf_complete_agent_job(job.id, ok, prUrl, error, branchName)
                  break_to_next_iter
              # 409 already_claimed → другая машина успела, идём дальше

      # 2. Иначе — задачи в TODO без явной очереди:
      if p.openTaskCount > 0:
          tasks = pf_list_tasks(p.id)
          todo = tasks.filter(t => t.status == 'todo')
          if todo:
              work_on_task(todo[0])
              break_to_next_iter

  # Ничего не нашли активного — пауза.
  sleep(10m)
```

**Почему именно так:**

- `pf_list_my_dispatched_projects` — единственный источник «где мне работать».
  Не поллим всё подряд через `pf_list_projects` и не угадываем.
- `queuedAgentJobCount` — explicit-сигнал «юзер хочет, чтобы агент это сделал».
  Имеет приоритет над общим TODO.
- `pf_claim_agent_job` атомарен; если 409 (`agent_job_already_claimed`) — не
  ругаемся, идём к следующему.
- Цикл завершается **одной job'ой за итерацию**. Между итерациями — спячка,
  чтобы дать юзеру шанс отменить или скорректировать.

## Жизненный цикл задачи

Когда Ralph берёт задачу (через `pf_claim_agent_job` или через TODO):

1. **Контекст.** `pf_get_task(projectId, taskId)` — задача + аттачи + тред
   комментариев. **Всегда читай комменты** перед работой: там могут быть
   уточнения, ссылки, прошлые попытки.
2. **Старт.** `pf_create_task_comment(projectId, taskId, "🤖 беру в работу,
   план: …")` — короткий человекочитаемый старт-апдейт. Mentions `@displayName`
   шлют notifications.
3. **Если нужны секреты.** `pf_get_credential(projectId, slug)` — plaintext.
   `pf_list_credentials` — посмотреть какие есть.
4. **Если работа с git'ом.** Используй свой собственный GitHub OAuth-токен:
   `pf_get_my_account()` → `github.accessToken`. Делай ветку
   `agent/<short-task-id>-<slug>`, коммить с `[<short-task-id>]` в message
   (например `[a1b2c3d4] feat: add X`), пуш.
5. **Линк коммитов.** После каждого `git push`:
   `pf_link_commit_to_task(projectId, taskId, sha)`. Auto-transition
   `todo → in_progress` происходит автоматически на первом линке.
6. **Блокер.** Если уперлись (нужно решение юзера, потеря доступа, неоднозначный
   scope) — `pf_create_task_comment` с описанием и `@mention` владельца, потом
   `pf_complete_agent_job(ok=false, error=<коротко>)`.
7. **Финал успеха.** `pf_create_task_comment` с PR-URL'ом → `pf_move_task` в
   `done` → `pf_complete_agent_job(ok=true, prUrl, branchName)`.
8. **Если задача из job-очереди** — `pf_complete_agent_job` обязателен (без
   него job висит в `running` и юзер не видит результат).

## Координация между Ralph-instance'ами одного юзера

- Несколько машин юзера могут крутить Ralph параллельно.
- `pf_claim_agent_job` — единственная race-safe операция. На неё опирайся.
- Если на проекте **только TODO без job'ов** (без явной делегации), две машины
  могут начать одну и ту же задачу одновременно. **Workaround:** перед стартом
  работы над TODO-задачей создавай комментарий
  `pf_create_task_comment(..., "🤖 claim by <machine-name>")` — другая машина
  это увидит в `pf_get_task` и пропустит. Не идеально, но честно.
- Лучшая практика — пользоваться job-очередью через UI: «Отправить агенту» в
  карточке задачи создаёт job, тогда coordination делается атомарно.

## Что НЕ должен делать Ralph

- **Удалять задачи/проекты/КБ-документы.** `pf_delete_task`, `pf_delete_project`,
  `pf_delete_kb_document` — никогда без явного запроса юзера в комментарии.
- **Двигать в `done` не свою работу.** Только задачи, которые Ralph закрыл сам.
- **Менять диспетчера.** `pf_set_project_dispatcher` — owner-only, и обычно
  делается через UI.
- **Назначать себя где не назначен.** Если `pf_list_my_dispatched_projects`
  пуст — это значит «работы нет», а не «возьми любой».
- **Срочные / деструктивные действия.** Деплои, миграции, force-push в main —
  оставляй человеку. Ralph делает feature-ветки и PR'ы.

## Ошибки и graceful degradation

| Симптом | Действие |
|---|---|
| `pf_list_my_dispatched_projects` 401 `agent_token_invalid` | Токен revoked — Ralph выходит, требуется новый setup |
| `pf_claim_agent_job` 409 `agent_job_already_claimed` | Другая машина успела — идём к следующей job/проекту |
| `pf_complete_agent_job` 409 `agent_job_not_in_running_state` | Job отменена юзером во время работы — НЕ делай PR, почисти branch, выйди молча |
| `pf_link_commit_to_task` 404 GithubApiError | SHA ещё не на GitHub — повтори через 5 сек (push мог не дойти) |
| `pf_get_credential` 404 `secret_not_found` | Секрет утерян из vault — оставь комментарий юзеру, выйди |

## API vs MCP

**Используй MCP-тулы** — это primary API для Ralph'а:

- Авто-аутентификация через agent-token из конфига.
- Type-safe ответы, не нужно парсить JSON.
- Стабильный контракт (semver `@projectsflow/mcp-server` в npm).

Прямой REST (`/api/agent/*`) есть как escape-hatch для случаев, когда MCP-тула
ещё нет:

- Все endpoint'ы под `/agent` — Bearer-auth (`Authorization: Bearer <token>`).
- Документация — в исходниках:
  [`server/src/presentation/agent/apiRoutes.ts`](../server/src/presentation/agent/apiRoutes.ts).
- Если регулярно дёргаешь сырой REST — напиши issue, чтобы добавили MCP-тул.

## Best practices

- **Маленькие PR'ы.** Одна задача = один PR, желательно <500 строк diff'а.
- **Сообщения в кардочке.** На каждой ключевой точке (старт, блокер, PR
  открыт, готово) — один короткий `pf_create_task_comment`. Без шума.
- **Уважай scope.** Если задача переросла размер «маленького PR'а» — оставь
  комментарий, запроси split, не пытайся «доделать всё».
- **Не reckless.** Если в задаче нет clear acceptance-критериев — задай
  уточняющий вопрос (`@<owner>` в комменте) и заверши job ok=false с
  `error: "needs_clarification"`. Это нормальный исход.
- **Логи.** Каждый pollting tick — короткая stderr-строка. Юзер должен видеть,
  что Ralph жив, без spamа stdout.

## Минимальный пример полного цикла

```
[tick 14:05:00]
> pf_list_my_dispatched_projects()
< [{id: "abc", name: "Acme лендинг", openTaskCount: 1, queuedAgentJobCount: 1}]

[abc] queued=1 → fetch job
> pf_list_pending_agent_jobs(limit=10)
< [{id: "j1", projectId: "abc", taskId: "t1", taskDescription: "Fix mobile menu"}]

> pf_claim_agent_job("j1")
< {status: "running", ...}

> pf_get_task("abc", "t1")
< {task: {...}, comments: [{body: "после фикса проверь Safari"}]}

> pf_get_credential("abc", "github-pat")
< {fields: {token: "ghp_..."}}

[work happens: branch, edit, commit "[t1] fix(menu): close on outside tap", push]

> pf_link_commit_to_task("abc", "t1", "<sha>")
< {commit: {...}}

> pf_create_task_comment("abc", "t1", "PR #42 открыт. Safari проверил — ok.")

> pf_move_task("abc", "t1", "done")

> pf_complete_agent_job("j1", {ok: true, prUrl: "https://github.com/.../pull/42",
    branchName: "agent/t1-fix-mobile-menu"})
< 204

[sleep 10m → next tick]
```

---

**Версия гайда:** synced с `@projectsflow/mcp-server@0.13.0`.
Список MCP-тулов — `mcp-server/README.md`.
