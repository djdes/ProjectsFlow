# Telegram-бот: авто-AI-перефраз сообщения в задачи (простой/быстрый compose)

Дата: 2026-06-07
Статус: согласован, готов к плану реализации

## Проблема / цель

Сейчас бот `@ProjectsFlow_Bot` на любое не-командное сообщение запускает ручной
конструктор (`TelegramComposerService.startFromMessage`): парсит `+Проект … @Делегат`,
нечётким матчем подбирает проект/исполнителя, показывает карточку и создаёт задачу
**как есть** — без перефраза, без авто-дедлайна, без авто-классификации.

Хотим: **любое** сообщение боту сразу прогоняется через тот же «простой/быстрый» AI,
что и кнопка AI при создании задачи на сайте (compose pass-1, sonnet) — с перефразом,
авто-определением проекта/исполнителя/дедлайна и аккуратной вёрсткой, — а пользователю
показывается «Ожидайте, перефразирую…» с анимацией и в конце карточка с кнопками
создать/отменить.

## Решения (согласовано с пользователем)

1. **Несколько задач.** Сообщение может содержать несколько задач — AI режет на сегменты
   (как «умное распределение» на сайте, `mode:'compose'`). Одна задача → один сегмент.
2. **Анимация — спиннер в сообщении.** Сообщение «⏳ Ожидайте, перефразирую…» с
   редактируемыми кадрами спиннера каждые ~2.5с, пока идёт обработка.
3. **Карточка с правками.** Показываем перефраз + авто-поля + кнопки создать/отменить
   И возможность поправить проект/исполнителя/дедлайн до создания.

## Что переиспользуем (существующая инфраструктура)

- **AI:** server-side use-cases `EnqueueAiPromptJob` и `WaitForAiPromptJob`
  (`server/src/application/ai-prompt/`). Composer — server-side, поэтому вызывает их
  **напрямую через DI**, без HTTP.
  - `mode:'compose'` = pass-1 = «простой/быстрый» вариант. Модель (sonnet) выбирается
    диспетчером ralph в воркере — на стороне ProjectsFlow ничего про модель не задаём.
  - `compose-advanced` (pass-2, opus) **не используем** — это и есть «только простой».
  - Выход pass-1 (см. `ralph/prompts/ai-prompt-compose-pass1.md`): JSON
    `{version, segments:[{id,title,simpleBody,projectId,projectName,confidence,
    assigneeUserId,assigneeName,deadline}]}`. `simpleBody` — причёсанный markdown
    (списки/жирный), **без заголовков верхнего уровня**; `deadline`/`assignee` — только
    при явном указании в тексте.
- **Создание задачи:** `CreateTask` (`server/src/application/task/CreateTask.ts`) уже
  поддерживает `deadline` (YYYY-MM-DD) и `delegateUserId` (делегирование, в т.ч. в
  именованный проект через `delegateOrThrow` — лучше текущего бота, который форсит inbox).
  Заголовок зашиваем в `description` как на сайте: `**${title}**\n\n${simpleBody}`.
- **Telegram-вывод:** `TelegramClient` (`sendMessage`/`editMessageText`/
  `answerCallbackQuery`), уже используется composer'ом.
- **Драфт + кнопки:** таблица `telegram_task_drafts`, callback-схема composer'а,
  edit/picker-рендеры — расширяем, не переписываем.

## Архитектура потока

Точка входа не меняется: `HandleTelegramWebhook` → `composer.startFromMessage(tgUserId,
chatId, rawText)` для не-командного/не-reply текста.

Новая логика внутри `startFromMessage`:

1. Резолв `userId` по `tgUserId`. Не привязан → текущее сообщение «привяжи аккаунт» (как
   сейчас), AI не зовём.
2. Пре-парс `+Проект` (через существующий `parseComposerMessage` + `fuzzyMatch`/
   `greedyProjectPrefix`): если проект однозначно резолвится → это `projectId`-hint
   (передаём в enqueue **и** после compose пиним все сегменты на него; исполнителя берём
   из участников этого проекта). Иначе `projectId = null` (кросс-проектное авто).
   `@Делегат` остаётся в тексте — авто-детект исполнителя AI его подхватит.
3. `sendMessage(chatId, "⏳ Ожидайте, перефразирую…")` → `waitMsgId`.
4. `EnqueueAiPromptJob({ userId, text, projectId: hint, mode:'compose' })`.
5. **Спиннер + ожидание параллельно:**
   - Фоновый цикл: `editMessageText(waitMsgId, "<кадр> Ожидаю, перефразирую…")`,
     кадры `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, шаг ~2.5с. Любая ошибка edit — только в лог, не падаем.
   - `WaitForAiPromptJob({ userId, jobId, maxWaitMs: 50_000 })` в цикле до 3 раз
     (≈150с суммарно, как клиентский `ComposeTasks`), пока статус не терминальный.
   - На терминальном статусе / по исчерпании попыток — спиннер останавливаем.
6. **Успех (`succeeded`):** парсим `improvedText` (JSON сегментов; парс обёрнут в
   try/catch). Сохраняем сегменты в драфт. `editMessageText(waitMsgId, …)` → карточка.
7. **Деградация** (enqueue бросил `AiPromptDispatcherNotConfiguredError` /
   `AiPromptProjectHasNoDispatcherError` / `AiPromptRateLimitedError`; job `failed`/
   `cancelled`; таймаут; невалидный JSON): тихо откатываемся на **текущий ручной флоу** —
   создаём драфт как раньше и показываем старую карточку (`renderConfirm`/пикеры),
   редактируя `waitMsgId`. Бот всегда остаётся рабочим, даже если диспетчер офлайн.

> Вебхук уже fire-and-forget (отвечает 200 сразу, обработка в фоне), поэтому ожидание до
> ~150с не блокирует ответ Telegram. В плане — проверить, что нет глобального таймера,
> убивающего фоновую обработку апдейта.

## Модель данных

В таблицу `telegram_task_drafts` (`server/src/infrastructure/db/schema.ts`) добавляем
nullable JSON-колонку **`segments`**:

```ts
segments: [
  {
    id: string;            // "s1"… из pass-1
    title: string;
    body: string;          // simpleBody
    projectId: string | null;
    projectName: string | null;
    assigneeUserId: string | null;
    assigneeName: string | null;   // сырое имя-подсказка, если userId не сматчился
    deadline: string | null;       // YYYY-MM-DD
    included: boolean;             // тогл «включить в создание», default true
  }
]
```

- Ручной (не-AI) путь оставляет `segments = null` — старое поведение не меняется.
- **Чтение через `parseJsonCol`** (на PROD MariaDB Drizzle `json()` отдаёт строкой — см.
  заметку «MariaDB JSON-as-string gotcha»; dev MySQL парсит сам). Обернуть в
  `TelegramTaskDraftRepository` при чтении, как остальные json-колонки.
- `TelegramTaskDraftRepository` + доменный тип `TelegramTaskDraft` расширяем полем
  `segments`; `create`/`patch` умеют его писать. TTL прежний (30 мин на composing).
- `offered` (нечёткие варианты проектов/участников) переиспользуем для пикеров правки
  (грузим список лениво при тапе «✏️»).

## UI карточек (подход A — одна сводная карточка)

### Несколько сегментов (N>1)

```text
🆕 Распознал 2 задачи:

1. Обновить билд FilterMusic
   📁 FilterMusic · 👤 Олег · 📅 2026-06-09
2. Починить отчёт по заказам
   📁 OrdersFlow · 📅 —

[ ✅ Создать все (2) ] [ ✖️ Отменить ]
[ ✏️ 1 ] [ ✏️ 2 ]
```

- `✅ Создать все (N)` — создаёт все `included`-сегменты (см. «Создание»).
- `✏️ N` → под-карточка правки сегмента N:
  - `📁 Сменить проект` (пикер проектов), `👤 Сменить исполнителя` (пикер shared-members
    выбранного проекта; «🚫 без исполнителя»), `🗑 Исключить задачу` (тогл `included`),
    `⬅️ Назад` к сводной карточке.
  - Дедлайн редактируем простым набором кнопок-пресетов («Сегодня / Завтра / Без срока»);
    произвольную дату — не делаем (YAGNI; в боте редкость, можно поправить на сайте).
- Счётчик в «Создать все (N)» учитывает только `included`.

### Один сегмент (N==1)

Схлопывается в карточку, близкую к текущей `renderConfirm`, но с перефразом и авто-полями:

```text
🆕 Новая задача
📁 Проект: FilterMusic
👤 Исполнитель: Олег
📅 Срок: 2026-06-09
📝 <перефразированный simpleBody, excerpt>

[ ✅ Создать задачу ] [ ✖️ Отменить ]
[ 📁 Сменить проект ] [ 👤 Сменить исполнителя ]
```

### Callback-схема

Расширяем существующую индексом сегмента (≤64 байта callback_data укладывается, `draftId`
короткий):

- `tp:<draftId>:<seg>:<sel>` — выбор проекта для сегмента `seg`.
- `td:<draftId>:<seg>:<sel>` — выбор исполнителя для сегмента `seg`.
- `tl:<draftId>:<seg>:<preset>` — дедлайн-пресет (`today|tomorrow|none`).
- `te:<draftId>:<seg>` — открыть под-карточку правки сегмента; `tb:<draftId>` — назад.
- `ti:<draftId>:<seg>` — тогл `included`.
- `tc:<draftId>` — создать все; `tx:<draftId>` — отмена (как сейчас).
- Делегатские `da:`/`dd:` (принять/отказать) — без изменений.

Парсер `parseCallback` и рендеры адаптируем под сегментный индекс. Для N==1 используем
`seg=0` под капотом, но кнопки показываем «плоско» (без номера).

## Создание задач

На `tc` (создать все) для каждого `included`-сегмента:

- `description = title ? '**'+title+'**\n\n'+body : body` (как `AiComposeDialog.createTasks`).
- `deadline = segment.deadline` (реальное поле).
- Если `assigneeUserId` валиден (участник выбранного проекта) → `CreateTask` с
  `delegateUserId` в **выбранный проект** (`delegateOrThrow` для именованного проекта). Если
  проект не выбран (Входящие) → как сейчас, делегирование через inbox.
- `projectId` сегмента = выбранный проект; `null` → `getOrCreateInbox`.
- Невалидный/отсутствующий assignee → создаём без делегирования (как web роняет assignee).
- Результат редактирует карточку в итог: «✅ Создано задач: K (ошибок: M)» с коротким
  перечнем. Привязки `taskMessages.upsert` — как в текущем `finalize` (чтобы reply работал).

Ошибка отдельного сегмента не валит остальные (создаём в цикле, ошибки собираем).

## Деградация и ошибки

| Ситуация | Поведение |
| --- | --- |
| Юзер не привязан | Текущее сообщение «привяжи аккаунт», AI не зовём |
| Диспетчер не сконфигурирован / нет диспетчера | Откат на ручной флоу (создать как есть) |
| Rate-limit (`compose` 30/час) | Сообщение «лимит AI исчерпан, попробуй позже» + откат на ручной флоу |
| job `failed`/`cancelled` / таймаут (~150с) | Откат на ручной флоу |
| Невалидный JSON в `improvedText` | Откат на ручной флоу |
| Ошибка `editMessageText` спиннера | Только в лог; не прерываем |
| Черновик истёк к моменту нажатия | Текущее «Черновик истёк — начни заново» |

Все AI-вызовы и спиннер — best-effort: любая необработанная ошибка только логируется и не
ломает обработку апдейта (как остальной composer).

## Тесты

Расширяем `TelegramComposerService.test.ts` (моки `EnqueueAiPromptJob`/`WaitForAiPromptJob`/
`TelegramClient`):

- Успех, 1 сегмент → одиночная карточка; `tc` создаёт 1 задачу с `deadline`/делегированием.
- Успех, N сегментов → сводная карточка; `ti` исключает сегмент; `tc` создаёт только
  включённые.
- Правка: `te` → `tp`/`td`/`tl` меняют поля сегмента в драфте.
- Деградация: enqueue бросает `AiPromptDispatcherNotConfiguredError` → ручной флоу.
- Деградация: `WaitForAiPromptJob` → `null` (таймаут) → ручной флоу.
- Деградация: невалидный JSON → ручной флоу.
- Спиннер: edit-ошибка не прерывает поток (мок бросает на edit).

Юнит на парс/сериализацию `segments` (round-trip + `parseJsonCol` строкового входа).

## Затрагиваемые файлы

| Файл | Изменение |
| --- | --- |
| `server/src/infrastructure/db/schema.ts` | +nullable JSON `segments` в `telegram_task_drafts` |
| миграция БД (drizzle) | ALTER TABLE add column `segments` |
| `server/src/application/telegram/TelegramTaskDraftRepository.ts` | тип + чтение через `parseJsonCol` + запись `segments` |
| `server/src/application/telegram/composer/TelegramComposerService.ts` | AI-шаг в `startFromMessage`, спиннер, парс сегментов, новые рендеры/коллбэки, создание из сегментов, деградация |
| DI-контейнер (composition root, где собирается composer) | прокинуть `EnqueueAiPromptJob`/`WaitForAiPromptJob` в `Deps` |
| `server/src/application/telegram/composer/TelegramComposerService.test.ts` | новые тесты |

## Вне рамок (YAGNI)

- `compose-advanced` (pass-2 opus) — не вызываем.
- Произвольный выбор даты дедлайна в боте (только пресеты).
- Изменение LIVE-стриминга / verify / прочих подсистем диспетчера.
- Редактирование текста перефраза прямо в боте (правим только проект/исполнитель/дедлайн/
  включение; текст — на сайте после создания).
