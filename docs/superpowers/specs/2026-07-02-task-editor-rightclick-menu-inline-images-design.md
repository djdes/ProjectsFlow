# Редактор задачи: меню форматирования по правой кнопке + inline-скрины в окне «Новая задача»

> Дата: 2026-07-02. Дизайн согласован (охват — «везде в описании задачи»).

## Проблемы

1. В редакторе описания задачи меню форматирования (`FloatingFormatMenu`) всплывает **при
   выделении текста** — мешает. Нужно, чтобы оно появлялось **только по правой кнопке мыши**
   (контекстное меню, Notion-style). Правый клик уже реализован (`contextmenu` handler в
   `RichTextEditor`), но выделение ТОЖЕ открывает меню (эффект `selectionUpdate`).
2. В окне «Новая задача» (`AddTaskDialog`) нельзя вставить скриншот **между абзацами** — вставка
   картинки уходит в аттачи (`onPasteFiles`), а не inline-блоком. В окне задачи (`TaskDrawer`)
   inline-картинки и drag-reorder блоков уже работают; окну создания просто не прокинули эту логику.

## Дизайн

### 1. `selectionMenu?: boolean` в `RichTextEditor` (по умолчанию `true`)

В эффекте `selectionUpdate` (открытие меню по выделению) добавить ранний `return`, когда
`selectionMenu === false` — но **после** веток закрытия (`NodeSelection` / пустое выделение), чтобы
меню, открытое правым кликом, корректно закрывалось при клике/схлопывании выделения. Правый клик
(`contextmenu` handler), закрытие по `pointerdown` вне меню и Escape — не трогаем.

Прокинуть `selectionMenu={false}` во все редакторы **описания задачи**:
- `AddTaskDialog` (окно «Новая задача»),
- `TaskDrawer` create-mode (объединённое поле заголовок+описание),
- `TaskBodyEditor` (тело задачи в режиме редактирования).
Комментарии (`variant="comment"`) остаются с меню-по-выделению (не в охвате).

### 2. Inline-скрины в `AddTaskDialog` (зеркало `TaskDrawer` create-mode)

- `inlineImagesRef = useRef<Map<string, File>>()` — стейджинг `blob:URL → File`.
- `uploadImageInline(file, onProgress)`: `URL.createObjectURL(file)` → положить в ref →
  `onProgress(100)` → вернуть `blobUrl` (превью сразу, реальная загрузка отложена).
- Прокинуть `onUploadImage={uploadImageInline}` в `RichTextEditor` (картинки → inline-блок в позицию
  курсора; не-картинки по-прежнему через `onPasteFiles` → аттачи).
- В `handleSubmit` после создания задачи: для каждого `[blobUrl, file]`, если `blobUrl` есть в
  описании — `uploadAttachment(targetId, task.id, file)`, заменить `blobUrl` → `att.url` в markdown,
  затем `taskRepository.update(targetId, task.id, { description })`. Revoke blob-URL, очистить ref.
  (Точно как в `TaskDrawer`.)
- Плейсхолдер обновить: скрин теперь вставляется в текст, а не в аттачи.
- Drag-reorder блоков (ручка-«6 точек») уже включён для `variant="description"` — проверить, что
  ручка не обрезается паддингом/overflow диалога; при необходимости дать левый отступ.

## Крайние случаи

- Правый клик по пустому месту/пунктуации (при `selectionMenu=false`): `selectWordAt` не выделит
  слово → пустое выделение → меню закроется сразу. Приемлемо (форматировать нечего). По слову или
  существующему выделению — меню открывается и держится.
- Картинка вставлена, но `blobUrl` удалён из текста до сабмита → просто revoke, не грузим.
- Ошибка загрузки inline-картинки → toast, задача уже создана (описание останется с blob-URL,
  который после перезагрузки не отрисуется — как и в текущем `TaskDrawer`; известное поведение).

## Критерии приёмки

- В описании задачи (создание + редактирование) меню форматирования только по правой кнопке;
  выделение текста меню не открывает. Комментарии — без изменений.
- В окне «Новая задача» скрин из буфера вставляется inline-блоком между абзацами; блоки
  (абзацы/картинки) переставляются ручкой-«6 точек»; при сохранении картинки грузятся и описание
  обновляется на реальные URL.
- `cd server && npx tsc --noEmit` не требуется (только клиент). Клиент: `npm run typecheck`,
  `npm run lint`, `npm run build:client` чисто. `http.ts` не трогаем.

## Файлы

- `client/src/presentation/components/editor/RichTextEditor.tsx` (+ `selectionMenu`)
- `client/src/presentation/components/forms/AddTaskDialog.tsx` (inline-картинки + `selectionMenu={false}`)
- `client/src/presentation/components/tasks/TaskBodyEditor.tsx` (`selectionMenu={false}`)
- `client/src/presentation/components/tasks/TaskDrawer.tsx` (create-editor `selectionMenu={false}`)

## Вне охвата

Комментарии, сервер, лендинг, новые БД-миграции. Переработка механизма стейджинга (реюз
существующего из `TaskDrawer`).

## SOP

Свой worktree, пуш от djdes через PAT `c://users/yaroslav/.gitcredentials`, автодеплой на main,
стейджить только свои файлы, футер `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
