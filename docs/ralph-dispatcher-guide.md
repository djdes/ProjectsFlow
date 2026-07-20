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
  # 0. AI-prompt-improvement jobs ПЕРВЫМ (юзер ждёт на long-poll'е ≤25 сек).
  ai_jobs = pf_list_pending_ai_prompt_jobs(limit=10)
  if ai_jobs.length > 0:
      job = ai_jobs[0]
      claimed = pf_claim_ai_prompt_job(job.id)
      if claimed:
          handle_ai_prompt_job(claimed)   # см. ниже § «AI prompt-improvement»
          continue
      # 409 already_claimed → другая машина успела, идём дальше

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

**Важно про периодичность.** AI-prompt-job'ы short-lived (юзер на long-poll'е ≤25 сек), поэтому диспетчер должен поллить их **чаще** обычных kanban-job'ов. Рекомендуемый интервал тика: **60 сек**. Сами AI-job'ы пикапятся каждый тик в начале, до любой другой работы.

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
4. **Если работа с git'ом.** Сначала попробуй **делегированный токен владельца**:
   `pf_get_project_git_token(projectId)`. Это GitHub OAuth-токен `project.ownerId`,
   разрешённый owner'ом через UI «Ralph-диспетчер» → toggle «Разрешить диспетчеру
   использовать мой GitHub-токен». Используй ТОЛЬКО для git-операций в этом
   проекте, НЕ персисти, НЕ логируй. Формат URL для push:
   `https://x-access-token:<token>@github.com/owner/repo.git`. Каждое обращение
   пишется в audit-log владельца.

   Если 403 `delegation_disabled` / `granter_not_owner_anymore` или 410
   `granter_github_disconnected` — fallback на свой собственный токен:
   `pf_get_my_account()` → `github.accessToken` (работает только если ты сам
   коллаборатор репо). Если и его нет — `pf_create_task_comment` с просьбой к
   owner'у включить делегирование, потом `pf_complete_agent_job(ok=false,
   error='no_git_token')`.

   Делай ветку `agent/<short-task-id>-<slug>`, коммить с `[<short-task-id>]`
   в message (например `[a1b2c3d4] feat: add X`), пуш.
5. **Линк коммитов.** После каждого `git push`:
   `pf_link_commit_to_task(projectId, taskId, sha)`. Auto-transition
   `todo → in_progress` происходит автоматически на первом линке.
   **v0.16+:** работает даже у диспетчера без собственного GitHub — сервер
   автоматически использует делегированный токен (тот же порядок выбора,
   что у `pf_get_project_git_token`: owner→displayName ASC, caller исключается).
   Owner видит это в audit-log'е с `context=link_commit`.
6. **Блокер.** Если уперлись (нужно решение юзера, потеря доступа, неоднозначный
   scope) — `pf_create_task_comment` с описанием и `@mention` владельца, потом
   `pf_complete_agent_job(ok=false, error=<коротко>)`.
7. **Финал успеха.** `pf_create_task_comment` с PR-URL'ом → `pf_move_task` в
   `done` → `pf_complete_agent_job(ok=true, prUrl, branchName)`.
8. **Если задача из job-очереди** — `pf_complete_agent_job` обязателен (без
   него job висит в `running` и юзер не видит результат).

## Запуск проекта и публикация сайта

Задача **«Запустить проект»** прилетает с кнопки в студии. Бриф к ней генерирует сервер
(`LaunchProject`): там уже подставлены id проекта, его `site_slug` и все шаги — читай задачу,
ничего искать не нужно. Ниже — то же самое для диспетчера, который хочет понимать механику.

> ⚠️ **Так эта задача уже была провалена.** Раньше кнопка создавала задачу с описанием из
> двух слов — «Запустить проект». Агент собирал фронтенд, видел зелёный `npm run build`,
> считал это запуском и закрывал задачу. Пользователь при этом продолжал видеть заглушку
> «сайт в разработке»: артефакт никто не публиковал.

**Запустить проект = собрать статику и ОПУБЛИКОВАТЬ её.** Платформа не исполняет
пользовательский код; сборка сама никуда не уезжает. Пока нет строки в `site_artifacts`,
проект не запущен — что бы ни показывала локальная сборка.

**Порядок работы:**

1. `npm ci` (нет lock-файла — `npm install`).
2. `npm run build` → каталог сборки (`dist/`, `build/`, `out/` — смотри конфиг сборщика).
   В корне каталога обязан лежать `index.html`.
3. **Опубликовать** содержимое каталога сборки MCP-тулом `pf_publish_site` (id проекта +
   каталог статики). Тул возвращает адрес сайта и время публикации.
4. Проверить `GET /api/projects/:projectId/site` → `deployedAt != null`, `fileCount > 0`.
5. Открыть `https://<site_slug>.projectsflow.ru` и убедиться, что отдаётся сайт, а не заглушка.

**Фолбэк без MCP** (Bearer agent-token, `requireDispatcherAccess`):

```
POST /api/agent/projects/:projectId/site-artifact
Content-Type: multipart/form-data

Каждый файл сборки — отдельным полем `files`; относительный путь внутри каталога сборки
кладётся в filename (`index.html`, `assets/app.js`). Ответ: { slug, url, publishedAt }.
```

Лимиты: до 2000 файлов, размер файла — по `MAX_SITE_BYTES`. Публикация заменяет предыдущий
артефакт целиком, так что заливать нужно ВЕСЬ каталог сборки, а не изменённые файлы.

**Логин и данные приложению** нужны не всегда. Если приложение требует авторизацию или
хранение данных — объяви схему через `pf_declare_app_schema` и переведи фронтенд на
`/api/auth/*` и `/api/data/*` (контракт — [docs/app-backend-contract.md](app-backend-contract.md)).
Обычному статическому сайту это не нужно, лишний вызов не делай. Строка в `app_backends` к
запуску сайта отношения не имеет — превью включается по `site_artifacts`.

**Definition of Done.** Закрывать задачу можно только когда `GET /api/projects/:id/site`
отдал `deployedAt != null` И поддомен отдаёт сайт. Зелёная сборка, поднятый `npm run dev`,
работающее превью на своей машине — не результат. Не получилось опубликовать — оставь
задачу открытой и напиши в комментарии, что мешает.

## Публикация правок визуального редактора (site-editor)

В студии проекта юзер правит живое превью — текст, стили, атрибуты, удаление
элементов. Каждая правка сразу ложится черновиком в `site_patches`. Когда юзер
жмёт **Edit второй раз**, сервер кладёт job в `project_edit_jobs`
(`operation: 'edit_code'`), и диспетчер должен перенести пачку правок в исходный
код проекта и пересобрать его.

> ⚠️ **Эта очередь долго не поллилась никем.** Серверная часть (роуты, claim,
> complete) была построена, а раннер про неё не знал — job'ы оставались в `queued`
> навсегда, и юзер бесконечно видел «Сохраняем правки в проект…». Если добавляешь
> новую очередь на сервере — сразу заводи и polling, иначе повторится.

**Эндпоинты** (Bearer, `requireDispatcherAccess`):

```
GET  /api/agent/pending-site-editor-jobs?limit=20      ← глобальная очередь, поллить эту
GET  /api/agent/projects/:projectId/site-editor/artifact
POST /api/agent/projects/:projectId/site-editor/jobs/:jobId/claim     { artifactVersion }
POST /api/agent/projects/:projectId/site-editor/jobs/:jobId/complete  { artifactVersion, status, result?, error?, summary?, steps? }
```

Есть и per-project `GET /projects/:projectId/site-editor/jobs/pending`, но полагаться
на него не стоит: обходить проекты по одному дорого, глобальная очередь для того и
заведена.

**Правка элемента приходит из чата проекта и туда же обязана вернуться.** Промпт юзера
уже лежит в диалоге отдельным сообщением, а рядом висит ассистентское «печатает…» —
его закрывает именно `complete`. Что попадёт в это сообщение:

- `summary` — слова ИИ о том, что он сделал («Увеличил заголовок до 40px»). Если поля
  нет, сервер берёт `result.message` (боевой воркер кладёт слова модели туда, рядом
  с патчем). Нет ни того, ни другого — в чат уйдёт общая фраза-заглушка.
- `steps` — `[{ kind: 'thought|query|read|write|review', detail, durationMs }]`,
  максимум 50. Рисуются сворачиваемым блоком «Рассуждения ИИ» над ответом. Не шлёшь —
  блока просто нет. `label` не отправляй: человекочитаемую подпись пишет сервер.

MCP-эквиваленты: `pf_list_pending_site_editor_jobs`, `pf_claim_site_editor_job`,
`pf_complete_site_editor_job`.

**Что лежит в job'е.** Для `edit_code` поле `domSnapshot` — это JSON-пачка патчей
(протокол `projectsflow.site-editor-publish.v1`):

```json
{
  "protocol": "projectsflow.site-editor-publish.v1",
  "route": "/catalog",
  "baseArtifactVersion": "…",
  "patches": [
    { "id": "…", "locator": {…}, "kind": "text|style|attribute|visibility|command|html",
      "payload": {…}, "createdRevision": 12 }
  ]
}
```

**Порядок работы:**

1. `claim` с текущим `artifactVersion`. Если прилетел 409 artifact-conflict — проект
   пересобрали после снятия правок; **не продавливать**, а завершить job'ом `failed`
   с коротким объяснением, чтобы юзер переснял правки на свежей сборке.
2. Применить патчи к исходникам по `locator`, прогнать проверки проекта.
3. Закоммитить, запушить, дождаться нового артефакта деплоя.
4. `complete` со `status: 'succeeded'` — только после того, как новая версия реально
   поднялась. `succeeded` удаляет queued-патчи (они теперь в исходниках), `failed`
   возвращает их в `draft`, так что работа юзера не теряется в любом случае.

**Тайминг.** Юзер всё это время смотрит на спиннер «Сохраняем правки в проект…».
Клиент ждёт 12 минут, потом показывает «Диспетчер не ответил» — правки при этом
остаются сохранёнными черновиком. Реальный цикл: 1–4 мин на работу агента над кодом
плюс 90–150 сек на деплой.

## Проект со своим сервером (конверсия на бэкенд платформы)

Платформа **не исполняет** пользовательский код: она раздаёт статическую сборку и обслуживает
`/api/auth/*` и `/api/data/*` на том же поддомене. Проект с собственным `server.js` и своей
MySQL/Postgres не заработает здесь никогда — его негде запускать.

Признаки такого проекта: в `package.json` есть `start`/`dev`, поднимающий сервер, а в
зависимостях драйвер БД (`mysql2`, `pg`, `mongodb`).

**Не запускай его локально и не считай это результатом.** Вместо этого — конверсия по
контракту: [docs/app-backend-contract.md](app-backend-contract.md). Там реальная поверхность
API (сверяется тестом с роутером), формат схемы, правила доступа, коды ошибок и разобранный
пример «было/стало».

Ограничения проговаривай владельцу **до** конверсии, а не после удаления рабочего сервера:
серверная логика между запросами (крон, вебхуки, интеграции по секрету), произвольный SQL
(джойны, агрегаты, транзакции) и перенос существующих данных в контракт не входят.

## AI prompt-improvement

Сайт ProjectsFlow добавил кнопку «AI» в формах создания задач (`AddTaskDialog`,
`QuickAddTodo`). Юзер вводит обрывочный текст, жмёт кнопку — сервер кладёт job в
очередь `ai_prompt_jobs`. Диспетчер пикапит, переписывает текст через свою Claude-
сессию, возвращает результат. Юзер видит обновлённую textarea через 5–25 сек.

См. полную спеку — [docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md](superpowers/specs/2026-05-28-ai-prompt-improvement-design.md).

> **Реальный диспетчер сейчас.** `dispatch.ps1` в репо `C:\www\ralph` —
> long-running PowerShell, который ходит в REST API напрямую (НЕ через MCP).
> Раздел ниже описывает **MCP-flow для альтернативного диспетчера** на `/loop`
> Claude Code. Для интеграции в `dispatch.ps1` см.
> [c:/www/ralph/docs/superpowers/specs/2026-05-28-ai-prompt-improvement-integration-design.md](https://github.com/djdes/PFLoopDispatch/blob/main/docs/superpowers/specs/2026-05-28-ai-prompt-improvement-integration-design.md) —
> там REST-вызовы вместо MCP-tools, лёгкий `claude -p` без MCP-конфига.

**Псевдокод `handle_ai_prompt_job`:**

```python
def handle_ai_prompt_job(job):
    # job содержит inputText (черновик от юзера) и kbContext (опционально —
    # пре-собранный KB-бандл). Если kbContext != null — добавляем как фон.
    system = """Ты помощник по постановке задач в трекере проектов.
Получаешь короткий черновик описания задачи от пользователя и переписываешь
его в виде ясной постановки на русском языке.

Правила:
- Сохраняй исходный смысл и намерение автора.
- Простой язык, короткие предложения, без канцеляризмов.
- Структура: 1-2 предложения сути + (опционально) список шагов.
- Домысливай разумные детали; помечай «предположительно».
- Если дан KB-контекст — используй терминологию проекта, не цитируй дословно.
- НЕ выдумывай людей, дедлайны, ссылки.
- Объём: ≤800 символов.
- Возвращай только переписанный текст, без преамбул и markdown-заголовков."""
    user_msg = ""
    if job.kbContext:
        user_msg += f"Контекст проекта (база знаний):\n{job.kbContext}\n\n---\n\n"
    user_msg += f"Черновик задачи:\n{job.inputText}"

    try:
        # Anthropic SDK; включить prompt caching на system (он стабилен).
        resp = claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_msg}],
        )
        improved = resp.content[0].text.strip()
        pf_complete_ai_prompt_job(job.id, ok=True, improvedText=improved)
    except Exception as e:
        pf_complete_ai_prompt_job(job.id, ok=False, error=short(e))
```

**Этикет AI-job'ов:**

- Это **short-lived**: юзер ждёт на long-poll'е до 25 секунд. Бери в работу сразу,
  не откладывай. Если в очереди есть AI-job — это всегда приоритет над kanban.
- 409 `ai_prompt_job_already_claimed` — нормальная гонка между Ralph-инстансами.
  Пропусти, попробуй следующий.
- 409 `ai_prompt_job_not_in_running_state` после `pf_complete_ai_prompt_job` — job
  был отменён server-side cleanup'ом (queued/running старше 5 мин → cancelled).
  Не retry'ай, просто залогай и дальше.
- НЕ читай KB сам — он уже в `job.kbContext`, сервер пре-собрал. Если NULL — значит
  у проекта нет KB или Inbox-задача. Работай только с `inputText`.
- НЕ оставляй task-комментарии и НЕ создавай PR'ы из AI-job'а. Это не kanban-task,
  пользователь не ждёт ничего кроме переписанного текста в textarea.

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

## Делегирование GitHub-токена (per-member opt-in, v0.15+)

Любой член проекта может разрешить дежурному Ralph-диспетчеру использовать
СВОЙ OAuth-токен GitHub для git-операций в репо этого проекта. Зачем это
нужно: на совместных проектах диспетчер часто не имеет GitHub-доступа к репо;
делегация даёт ему рабочий токен от того, кто доступ имеет.

**Как это работает:**

- На странице проекта, в секции «Ralph-диспетчер», каждый член видит свой
  toggle «Моя делегация». Owner дополнительно видит блок «Грантеры проекта» —
  упорядоченный список членов с их статусами + индикацией «кто будет выбран».
- При запросе токена сервер идёт по членам в строго детерминированном
  порядке:
  1. **Owner** (если у него enabled + подключён GitHub).
  2. Остальные члены с enabled-делегацией, отсортированные по `displayName ASC`
     (case-insensitive), при равенстве — по `email`.
  3. **Caller (текущий диспетчер) исключается** из кандидатов — даже если он
     сам член проекта и включил свою делегацию, токен бы взял свой обычным
     `pf_get_my_account` (отдавать свой через делегацию бессмысленно).
- Возвращается токен **первого** кандидата с подключённым GitHub. Response
  содержит `source: 'owner_delegation' | 'member_delegation'` и
  `grantedByDisplayName` — Ralph может в логи/комментарии писать «коммит
  пушится под аккаунтом X».
- Никто не подошёл (кандидаты есть, но без GitHub) → 403
  `no_eligible_grantor` с `candidatesChecked: N` в body для диагностики.
- Никто вообще не включил delegation → 403 `delegation_disabled`.
- Сервер берёт токен **live** из user_github_tokens на каждом запросе —
  ротация OAuth подхватывается автоматически. При revoke токена на GitHub
  юзер должен переподключить — после reconnect его кандидатура автоматически
  снова в строю.
- **v0.16+:** делегация работает не только для прямого вызова
  `pf_get_project_git_token`, но и для **server-side операций**, где сервер
  делает GitHub-запрос от имени caller'а: `pf_link_commit_to_task`,
  `pf_sync_commits`, KB-write для github-backed-KB. У диспетчера-админа без
  собственного GitHub эти операции тоже работают — берётся делегированный
  токен. В audit-log'е owner видит `context`: `link_commit` / `sync_commits` /
  `kb_write` отдельно от `git_token_fetch`.
- Каждое обращение (успех или нет) пишется в audit-log. Owner видит «кто и
  когда брал токен через этот проект» прямо в UI.

**Admin-on-behalf:** Admin через свою страницу управления юзерами может
включить/выключить делегацию любого члена за него (`PUT /projects/:id/git-token-delegation
{ enabled, granterUserId: <member-id> }`). Granter остаётся = указанный
member — admin технически просто жмёт. Owner это потом увидит в своём UI и
может выключить.

**Ralph-этикет:**

- Используй полученный токен **только** для git-команд (`git clone/push/fetch`,
  `gh pr create`). Не звони с ним левые GitHub API.
- НЕ персисти токен в файлы/env. Получи перед операцией, используй, забудь.
- НЕ логируй значение. Только prefix (`ghp_xxxx…`) если совсем нужно.
- При 403 от `pf_get_project_git_token` — fallback на свой собственный токен
  через `pf_get_my_account` (см. жизненный цикл задачи, шаг 4). Если и его
  нет — оставь комментарий owner'у с просьбой включить делегацию или
  подключить GitHub.

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
| `pf_get_project_git_token` 403 `delegation_disabled` | Никто из членов не включил toggle — fallback на свой токен через `pf_get_my_account` |
| `pf_get_project_git_token` 403 `no_eligible_grantor` | Кандидаты с включённой делегацией есть, но ни у кого не подключён GitHub. Body содержит `candidatesChecked` — для диагностики. Fallback на свой токен; если нет — комментарий owner'у с просьбой подключить GH |
| `pf_get_project_git_token` 403 `granter_not_owner_anymore` | (legacy v0.14, в v0.15+ не возвращается; перешли на per-member) |
| `pf_get_project_git_token` 410 `granter_github_disconnected` | (legacy v0.14, в v0.15+ не возвращается; кандидат без GH тихо пропускается, в итоге может быть `no_eligible_grantor`) |

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

**Версия гайда:** synced с `@projectsflow/mcp-server@0.16.0`.
Список MCP-тулов — `mcp-server/README.md`.
