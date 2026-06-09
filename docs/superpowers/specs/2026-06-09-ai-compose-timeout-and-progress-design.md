# AI-compose: убрать таймаут на больших промптах + прогресс при долгом ожидании

Дата: 2026-06-09
Статус: реализован

## Проблема

Большой/длинный промпт (пример пользователя — «ЗАДАЧИ НА СЕГОДНЯ» с двумя людьми, ~10 задач,
тысячи символов) на pass-1 не укладывается в watchdog и падает с `compose_pass1:timeout`.
На сайте — ошибка «AI не смог обработать», в боте — тихий откат в ручной черновик с сырым
текстом. Плюс при долгом ожидании пользователь не понимает, идёт ли процесс.

## Корень

- **ralph** гоняет compose pass-1 через `claude -p` с ЖЁСТКИМ wall-clock watchdog
  (`Invoke-ClaudeText` → `WaitForExit`). Был: default `composeWatchdogSeconds` 150с, потолок
  clamp 180с; пол в воркере `max(.,150)`. claude `--output-format text` не стримит → idle-watchdog
  невозможен без перехода на stream-json.
- **ProjectsFlow** ждал недолго: клиент `ComposeTasks.MAX_TOTAL_MS=180с`, бот `pollCompose`
  3×50=150с. Даже если бы watchdog был длиннее, клиент/бот бросали раньше.

## Решение (потолок 15 мин, согласовано)

### A. ralph — длинный watchdog
- `ai-job-worker.ps1` (детачнутый воркер, спавнится заново на каждый job — **живёт без рестарта
  диспетчера**): пол `max($ComposeWatchdogSec, 150)` → **300** в Do-Compose и Do-ComposeAdvanced.
- `dispatch.ps1`: default `composeWatchdogSeconds` 150→**300**; clamp `[30,180]`→`[30,**900**]`
  (15 мин — конфиг-максимум, после рестарта диспетчера); inline `Run-AiComposeWorker` —
  `$wd = max($script:AiComposeWatchdogSec, 300)`.
- Итог: без рестарта compose может идти до 300с; с рестартом + конфигом — до 900с.
- `.ps1` перекодированы в UTF-8 BOM, синтаксис проверен `Parser::ParseFile`.

### B. ProjectsFlow — поллинг ждёт дольше потолка watchdog (деплой через main)
- Клиент `ComposeTasks.MAX_TOTAL_MS` 180с → **960с** (≈16 мин > 900с watchdog).
- Бот `pollCompose` `COMPOSE_MAX_ATTEMPTS` 3→**20** (×50с ≈ 1000с). `WaitForAiPromptJob`
  per-call (60с) не трогаем — цикл повторяет.
- Так клиент/бот не бросают раньше, чем отработает watchdog (нет ложного таймаута).

### C. Прогресс при ожидании >60с (web + TG)
- Web `AiComposeDialog`: новый `elapsedSec` (тикает интервалом только в фазе `loading`); при
  `elapsedSec >= 60` в карточке загрузки — «Большой промпт — обрабатываю, это может занять
  несколько минут. Не закрывайте окно. (N с)».
- Бот `startSpinner`: после 60с текст спиннера → «⏳ Большой промпт, обрабатываю… ничего не
  зависло (N с)» (с тикающими секундами).

## Затронуто

ralph (локально, не деплоится): `ai-job-worker.ps1`, `dispatch.ps1`.
ProjectsFlow (деплой через main): `client/src/application/ai/ComposeTasks.ts`,
`server/src/application/telegram/composer/TelegramComposerService.ts`,
`client/src/presentation/components/ai/AiComposeDialog.tsx`.

## Известный трейд-офф

Жёсткий «∞» небезопасен (зависший `claude` надо когда-то убить — иначе job висит вечно),
поэтому потолок 900с. Если диспетчер ОФЛАЙН, бот/клиент теперь ждут дольше (до ~16 мин) перед
откатом/ошибкой — приемлемо (редкий операционный случай; прогресс-сообщение информирует).
Альтернатива на будущее — idle-watchdog через `--output-format stream-json` (kill только при
отсутствии прогресса) + ранний откат, если job не `claimed` (диспетчер офлайн).
