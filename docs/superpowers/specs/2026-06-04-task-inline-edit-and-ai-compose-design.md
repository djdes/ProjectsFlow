# Inline-редактирование описания задачи + AI-compose в режиме правки

**Дата:** 2026-06-04
**Статус:** одобрено, реализуется
**Слой:** только `presentation` (без новых domain/application/infrastructure)

## Проблема

В дровере задачи (`TaskDrawer`) редактирование описания и AI-кнопка работают неудобно:

1. **Коробка вместо инлайна.** Клик по описанию подменяет рендеренный markdown на
   `<textarea rows={6}>` — фиксированная высота создаёт ощущение отдельного «текстового
   окна», а не правки текста на месте.
2. **AI-кнопка пропадает.** Кнопка ✨ AI рендерится только внутри ветки `editing`
   ([TaskDrawer.tsx:988](../../../client/src/presentation/components/tasks/TaskDrawer.tsx#L988)).
   Вышел из режима правки — кнопка исчезла.
3. **Слабое AI-действие.** В правке используется `AiImproveButton` (простой `improve`:
   один результат, без вариантов, без детекта проекта). В форме создания todo
   используется `AiComposeDialog` (два варианта «Простой/Продвинутый» + классификация
   проекта + разбивка). В правке хочется то же самое.

## Решение

### 1. Бесшовное инлайн-поле (без рамки)

`TaskDescriptionEditor` ([TaskDrawer.tsx:882](../../../client/src/presentation/components/tasks/TaskDrawer.tsx#L882)):

- Убрать `rows={6}` → **авто-высота**: на каждый `onChange` и при входе в правку
  `el.style.height = 'auto'; el.style.height = scrollHeight + 'px'`. Поле ровно по
  содержимому, без пустой коробки. `overflow-hidden` на textarea.
- Полная безрамочность: `border-transparent bg-transparent`, фокус без рамки,
  padding/leading/шрифт 1:1 с display-режимом (текст не «прыгает» при переключении).
- Поведение сохранения без изменений: Ctrl+Enter / blur — сохранить, Esc — отмена.
  Курсор в конец (точное попадание «куда кликнул» из рендеренного markdown в исходник
  ненадёжно — осознанное ограничение).
- Редактируется markdown-исходник (`**жирный**`, `## `).

### 2. AI-кнопка всегда рядом с текстом

- Вынести AI-кнопку **из ветки `editing`** в постоянную строку-шапку над описанием
  (подпись «Описание» слева, кнопка ✨ AI справа) — видна и в показе, и в правке,
  не двигается при переключении режимов.
- `text` кнопки = `editing ? draft : description` (работает над тем, что сейчас видно).
- Кнопку оборачиваем в `onMouseDown={(e) => e.preventDefault()}` — клик по AI не уводит
  фокус мгновенно (сохраняем существующую защиту от преждевременного blur-save).

### 3. AI = `AiComposeDialog` (как в форме создания) + edit-aware

В `TaskDescriptionEditor` заменить `AiImproveButton` → `AiComposeDialog`.

`AiComposeDialog` получает опциональный проп:

```ts
/** Контекст правки существующей задачи. Если задан — режим «По проектам» обновляет
 *  ЭТУ задачу для сегмента её проекта (без дубля), остальные проекты → новые задачи;
 *  текущая задача НИКОГДА не удаляется. */
readonly editTask?: { readonly projectId: string; readonly taskId: string };
```

Поведение при `editTask`:

- **«Применить» (одно поле):** `onImproved(text)` → редактор пишет описание и **сразу
  сохраняет** (`taskRepository.update`), карточка обновляется.
- **«По проектам» (edit-aware) в `createTasks()`:** первая включённая строка, чей
  проект == `editTask.projectId` (с учётом резолва inbox для строк без проекта),
  **обновляет текущую задачу** (`update`, без дубля). Остальные строки создаются как
  **новые** (`create`). Текущая задача не удаляется.
- **Дефолт `distribute`:** включаем, если AI предложил проект, отличный от текущего
  (`segment.projectId !== null && !== editTask.projectId`), или сегментов ≥2; иначе —
  одиночное поле (просто «сделать красиво» на месте).
- После распределения `onDistributed` → редактор зовёт `onSaved()` (рефреш дровера).

## Затрагиваемые файлы

| Файл | Изменение |
|---|---|
| `client/src/presentation/components/ai/AiComposeDialog.tsx` | проп `editTask`; edit-aware `createTasks()`; дефолт `distribute` с учётом текущего проекта; toast-сообщения для edit |
| `client/src/presentation/components/tasks/TaskDrawer.tsx` (`TaskDescriptionEditor`) | авто-высота безрамочной textarea; постоянная AI-шапка; `AiComposeDialog` вместо `AiImproveButton`; `applyAndSave` (сразу сохранить) |

## Вне scope

- Футер create-режима самого `TaskDrawer` остаётся на `AiImproveButton` (отдельная
  консистентность, не трогаем).
- WYSIWYG (Tiptap/ProseMirror) — отклонён: выбран бесшовный markdown-исходник, без новых
  зависимостей.

## Проверка

Client-тестов в репозитории нет. Верификация: `npm run typecheck`, `npm run lint`,
`npm run build` (все из корня) — без ошибок. Плюс визуальная проверка дровера.
