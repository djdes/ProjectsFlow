# Telegram-бот: выбор колонки канбана при создании задачи + дефолт «backlog»

Дата: 2026-06-08
Статус: реализован

## Требование

При создании задачи из Telegram-бота:
1. **По умолчанию** задача создаётся в колонке **`backlog`** (ЧЕРНОВИКИ), а не `todo`.
2. Перед созданием можно **выбрать колонку**, в которую пойдёт задача.
3. У проектов колонки называются **по-разному** — показывать названия конкретного проекта.

## Модель колонок (как есть в ProjectsFlow)

- Доска проекта = **ровно 4 колонки** фикс-порядка: `backlog → manual → todo → done`
  (`VISIBLE_KANBAN_STATUSES`, `server/src/domain/kanban/KanbanSettings.ts`). Это подмножество
  6-значного `TaskStatus` (статусы `in_progress`/`awaiting_clarification` — не колонки,
  рендерятся внутри `todo`). Пикер предлагает ровно эти 4 статуса.
- Кастомизируются только **подпись (label), цвет, скрытость (hidden)** — per-project, в
  `projects.kanban_settings` (JSON, sparse). Ключ статуса (`backlog/manual/todo/done`) —
  глобальный и стабильный. Порядок колонок — хардкод, без перестановки/добавления.
- Встроенные подписи: `backlog`=ЧЕРНОВИКИ, `manual`=В РУЧНУЮ, `todo`=ВОРКЕР, `done`=Готово.
  **Были только на клиенте** (`statusLabels.ts`); добавлены на сервер
  (`BUILTIN_KANBAN_LABELS` + `resolveColumnLabel` + `isColumnHidden` в `KanbanSettings.ts`).
- `getKanbanSettings(projectId)` уже есть в `ProjectRepository` и в зависимостях composer'а.

## Решения по развилкам

1. **Дефолт = `backlog`** (как в требовании). Семантически ЧЕРНОВИКИ. **Поведенческое
   следствие:** задачи из Telegram больше **не уходят сразу в очередь воркера** (`todo`=ВОРКЕР) —
   только когда пользователь выберет колонку «ВОРКЕР». Это намеренно.
2. **Скрытые колонки** (`hidden=true`) **прячем** из пикера (как на доске); `backlog`
   оставляем всегда (это дефолт-фолбэк).
3. **Смена проекта** не сбрасывает выбор: храним канонический **ключ статуса**
   (`backlog/manual/todo/done`); подпись перерисовывается под текущий проект.
4. Пикер добавлен **и в AI-сегменты, и в ручную карточку** подтверждения.

## Хранение

- AI-флоу: per-segment поле `targetStatus: VisibleKanbanStatus | null` в `TelegramDraftSegment`
  (внутри JSON-колонки `segments`, без миграции; `null` = дефолт `backlog`).
- Ручной флоу: top-level колонка **`target_status VARCHAR(20) NULL`** в `telegram_task_drafts`
  (миграция **db/068**; `null` = дефолт `backlog`). НЕ путать с `status`
  (`composing/confirmed/...` — лайфцикл черновика).

## UI / callback-схема

- Подпись колонки показывается в карточках: одиночной, сводной (мета-строка `📊 <колонка>`),
  карточке правки сегмента, ручной карточке подтверждения.
- Кнопка `📊 Колонка` → пикер из видимых колонок проекта (по их названиям).
- Callback-префиксы (короткий код колонки `b/m/t/d`, чтобы влезть в 64 байта):
  - AI: `as:<draftId>:<seg>:<?|b|m|t|d>` (`?` = открыть пикер).
  - Ручной: `ts:<draftId>:<?|b|m|t|d|x>` (`x` = назад к подтверждению).

## Создание

`createTask.execute({ status: <chosen> ?? 'backlog', ... })` во всех трёх местах
(`finalize` делегирование/без, `finalizeSegments`). `VisibleKanbanStatus ⊂ TaskStatus`,
валидация на создание любого статуса отсутствует — `backlog` всегда валиден.

## Тесты

`TelegramComposerService.test.ts`: дефолт backlog (AI и ручной), выбор `todo` кнопкой
(AI и ручной), пикер показывает кастомные имена и прячет скрытые, выбранное имя в карточке,
мульти-карточка показывает колонку каждой задачи. + мок `getKanbanSettings`/захват `status`.

## Затронутые файлы

`server/src/domain/kanban/KanbanSettings.ts`, `…/telegram/TelegramTaskDraftRepository.ts`,
`…/telegram/composer/TelegramComposerService.ts` (+тесты), `…/db/schema.ts`,
`…/repositories/DrizzleTelegramTaskDraftRepository.ts`, `db/068_telegram_draft_target_status.sql`.

## Вне рамок

Перестановка/переименование колонок из бота; редактирование текста задачи; статусы
`in_progress`/`awaiting_clarification` в пикере (они не колонки).
