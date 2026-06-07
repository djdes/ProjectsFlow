# AI-compose: ленивый «Продвинутый» вариант + быстрый pass-1

Дата: 2026-06-07
Статус: реализовано

## Проблема

Кнопка «AI» в композере (compose-режим) падала с `compose_pass1:timeout`.

Один `mode='compose'` job выполнял **два прохода opus-4-8 подряд**:

1. **pass-1** — разбивка черновика на задачи + «Простой» вариант + классификация по
   проектам/исполнителям/срокам;
2. KB-bundle задетектированных проектов;
3. **pass-2** — «Продвинутый» вариант (`advancedBody`) по полной KB.

Узкие места:

- pass-1 на медленном opus-4-8 упирался в watchdog (90с) → `compose_pass1:timeout`.
- Воркер в худшем случае шёл `90 + KB + 90 ≈ 185с+`, перерастая клиентский лимит
  (`MAX_TOTAL_MS = 180с`) — даже «успешный» двойной проход гонялся со временем.
- opus pass-2 считался ВСЕГДА, хотя вкладку «Продвинутый» пользователь часто не открывает.

Ключевое наблюдение: **pass-2 производит ТОЛЬКО `advancedBody`** (вкладка «Продвинутый»).
Весь «Простой» вариант и всё распределение (проект/исполнитель/дедлайн) даёт pass-1.

## Решение

Разрезать на два независимых job-режима и сделать pass-2 ленивым:

- **`mode='compose'`** → только **pass-1**, на **быстрой модели** (`composePass1Model`,
  default `sonnet-4-6`). Отдаёт сегменты без `advancedBody`. Это всё для немедленного показа.
- **`mode='compose-advanced'`** (новый) → только **pass-2**, на **opus-4-8** (`composeModel`).
  На вход — сегменты pass-1 (JSON-строкой в `inputText`), на выход — `{id, advancedBody}`.
  Запускается **лениво** из UI при первом открытии вкладки «Продвинутый».

Эффект: первый экран — после одного быстрого sonnet-вызова (таймаут уходит). Opus-вызов
случается только если реально открыли «Продвинутый» (часто — никогда → экономия). Каждый
job теперь однопроходный → структурно укладывается в клиентский лимит.

## Архитектура (3 репозитория)

### Сервер (ProjectsFlow/server)

- `domain/ai-prompt/AiPromptJob.ts`: `AiPromptJobMode` += `'compose-advanced'`,
  `AI_PROMPT_JOB_MODES` += то же.
- `infrastructure/db/schema.ts`: `mysqlEnum('mode', ['improve','compose','compose-advanced'])`.
- `application/ai-prompt/EnqueueAiPromptJob.ts`: `compose-advanced` трактуется как
  `compose` для резолва диспетчера и rate-limit (общий строгий compose-bucket, 30/час), но
  **НЕ** собирает контекст кандидатов (`prepareComposeContext` не зовётся, `kbContext=null` —
  полную KB воркер берёт сам по `projectId`'ам из сегментов через `/kb-bundle`).
- `presentation/ai-prompt/routes.ts` + `presentation/agent/apiRoutes.ts`: enqueue-схема
  допускает новый mode; свободный текст (improve / compose pass-1) — до **50000** символов
  (= maxLength поля композера и лимит описания задачи), `compose-advanced` (JSON сегментов) —
  до 200000; разделение через `superRefine`. Колонка `input_text` поднята до MEDIUMTEXT
  (db/066), так что байтового потолка TEXT (64КБ) больше нет.

### Миграция (ProjectsFlow/db)

- `db/065_ai_prompt_compose_advanced.sql`: `ALTER TABLE ai_prompt_jobs MODIFY COLUMN mode
  ENUM('improve','compose','compose-advanced') ...`. Добавление значения в конец ENUM —
  INSTANT-операция (без блокировки/перестройки).
- `db/066_ai_prompt_input_text_mediumtext.sql`: `input_text` TEXT → MEDIUMTEXT (под свободный
  текст до 50000 символов; тот же приём, что db/058 для description и db/060 для соседних колонок).
- Применяются на проде автодеплоем по push в `main` (GitHub Actions → `migrate.mjs` на сервере).

### Клиент (ProjectsFlow/client)

- `application/ai/AiPromptRepository.ts`: `AiPromptJobMode` += `'compose-advanced'`.
- `application/ai/ComposeTasks.ts`: новый метод `advance({ segments, projectId })` — enqueue
  `compose-advanced`, long-poll, `parseAdvancedResult` (map `id→advancedBody`). Общая
  JSON-экстракция вынесена в `extractJsonObject`.
- `presentation/components/ai/AiComposeDialog.tsx`: состояние
  `advancedPhase: idle|loading|ready|error` + `advancedById`. Первое открытие вкладки
  «Продвинутый» лениво запускает `advance()` по ТЕКУЩИМ строкам (учитывает правки
  проекта/заголовка); спиннер в области вкладки, ошибка → инлайн «Повторить». До загрузки
  `bodyFor(...,'advanced')` отдаёт `simpleBody` → «Создать»/«Применить» всегда работают.

### Воркер (ralph)

- `ai-job-worker.ps1`: `Do-Compose` → только pass-1 (модель `composePass1Model`); новая
  `Do-ComposeAdvanced` (mode `compose-advanced`) → парсит сегменты из `inputText`, тянет
  KB-bundle по `projectId`'ам, гонит pass-2 (opus), отдаёт `{id, advancedBody}`. Роутинг по
  `$Mode`.
- `dispatch.ps1`: новый конфиг `composePass1Model` (default `sonnet`) + алиас-маппинг;
  `Spawn-AiWorker` кладёт его в ctx воркера. `config.local.example.json` обновлён.

## Контракты результата (JSON-строка в `improvedText`)

- `compose` (pass-1): `{version, mode:'compose', segments:[{id, title, simpleBody, projectId,
  projectName, confidence, assigneeUserId, assigneeName, deadline}]}` — **без** `advancedBody`.
- `compose-advanced` (pass-2): `{version, mode:'compose-advanced', segments:[{id, advancedBody}]}`.

## Ошибки / деградация

- pass-1 (sonnet) таймаут/плохой JSON → `compose_pass1:*` (как раньше, но реже).
- advanced-job упал/таймаут → вкладка «Продвинутый» показывает ошибку + «Повторить»;
  «Простой» и распределение не страдают; создание задач падает на `simpleBody`.
- Порядок выката: сервер (ENUM-миграция) → воркер (новые режимы) → клиент. Совместимость
  деградирует мягко (старый клиент видит `advancedBody=simpleBody`).

## Тесты

- `EnqueueAiPromptJob.test.ts` (новый): compose-advanced → строгий compose-bucket,
  `kbContext=null`, без сбора контекста кандидатов; improve → мягкий bucket; rate-limit.
- Сборка + typecheck сервера и клиента зелёные; парс-чек `dispatch.ps1`/`ai-job-worker.ps1`.

## Известные долги

- Inline-копии compose-воркера в `dispatch.ps1` (`Run-AiPromptWorker` / `Run-AiComposeWorker`
  / `Get-AiPromptKbBundle` / `Parse-ComposeJson`) — **мёртвый код** (живой путь —
  `Spawn-AiWorker` → детач `ai-job-worker.ps1`). Удаление отложено: они переплетены с **живой**
  `Invoke-ClaudeText` (её зовут automation/triage/monitoring), безопасное вырезание требует
  отдельной аккуратной правки с парс-чеком.
- Локальная dev-БД отстала (нет даже `db/060`) и не годится как валидатор миграций; `065`
  проверена по форме (идентична применённой на проде `060`) и применится на проде через деплой.
