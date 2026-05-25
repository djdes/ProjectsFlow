# ТЗ: редизайн task-карточки — side-drawer + sticky-композер + status rename

> **Дата:** 2026-05-25 · **Статус:** на ревью.
> **Затрагиваемый scope:** только client/ (presentation-слой). Domain enum
> `TaskStatus`, server-API, БД — НЕ трогаются. Один новый client-only вызов
> «отменить работу» = композиция трёх существующих API.

## Context

Сейчас задача открывается центральной модалкой ([client/src/presentation/components/tasks/TaskDialog.tsx](client/src/presentation/components/tasks/TaskDialog.tsx)).
Внутри: описание (всегда редактируемое), аттачи (всегда меняются), комментарии
со встроенным композером, секция коммитов. Колонки на board'е:
`На подтверждении / TODO / Готово`.

Юзер хочет:

1. **Side-drawer** справа с возможностью развернуть на весь экран и обратно
   (как сегодня открываются страницы в Notion).
2. **Sticky-шапка** с летающим заголовком и горизонтальным рядом аттачей,
   видимым при скролле тела.
3. **Read-only режим** для не-backlog статусов: описание и аттачи редактируются
   ТОЛЬКО когда задача в `backlog` (визуально — «ЧЕРНОВИКИ»). В TODO и далее —
   просмотр.
4. **Sticky-композер снизу** drawer'а с переключателем `[В черновики ▎Воркеру]`.
   Default — «В черновики». Отправка комментария атомарно переносит задачу в
   соответствующий статус.
5. **Исключение для `in_progress`**: композер заменяется кнопкой «⛔ Отменить
   работу» — отменяет agent-job и возвращает в backlog.
6. **Визуальный rename** колонок (только UI-лейблы):
   - `backlog` → «ЧЕРНОВИКИ»
   - `todo` → «ВОРКЕР» + подпись «Claude Opus»
   - остальные — без изменений.

## Архитектурный выбор: Sheet (right) + custom inner layout

`TaskDialog` (shadcn `Dialog`, centered modal) → `TaskDrawer` (shadcn `Sheet`,
side="right"). Sheet уже есть в [client/src/components/ui/sheet.tsx](client/src/components/ui/sheet.tsx);
ему мы получаем «бесплатно»: overlay, focus-trap, esc-close, slide-in анимация.

**Expand-toggle:** иконка `Maximize2 / Minimize2` (lucide) в шапке drawer'а
переключает локальный state `expanded: boolean`, который меняет ширину
SheetContent между `sm:max-w-[640px]` и `sm:max-w-none w-screen`. На mobile
(`window.matchMedia('(pointer: coarse)').matches`) — drawer всегда full-width,
expand-toggle скрыт.

**Что НЕ берём:**
- `Dialog` со смещением вправо CSS-хаком — ломает mobile bottom-sheet logic из dialog.tsx.
- Кастомный drawer на motion/react с нуля — больше работы, не даёт преимуществ.

**Переименования в client/:**
- `TaskDialog` → `TaskDrawer` (компонент-файл переименовывается).
- `TaskDialogState` → `TaskDrawerState` (тип в том же файле).
- Точки использования: [client/src/presentation/components/tasks/KanbanBoard.tsx](client/src/presentation/components/tasks/KanbanBoard.tsx) — единственный consumer.

## Структура `TaskDrawer`

```
┌───────────────────────────────────────────────────┐
│ HEADER (sticky top, blur bg)                      │
│  ┌──────────────────────────────────────────────┐ │
│  │ ◀▶  PROJECT-NAME · [shortId]                 │ │
│  │     [статус-бейдж]  [ralph-mode ▾]        × │ │
│  ├──────────────────────────────────────────────┤ │
│  │ Одно-строчный preview описания (truncate)    │ │ ← клик в backlog → edit
│  ├──────────────────────────────────────────────┤ │
│  │ 📎 thumb1  📎 thumb2  📎 file.pdf … [+]      │ │ ← horizontal row, [+] только backlog
│  └──────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────┤
│ BODY (overflow-y: auto)                           │
│   • Полное описание (edit в backlog / read-only)  │
│   • Комментарии (без встроенного composer'а)      │
│   • TaskCommitsSection (если showCommits)         │
├───────────────────────────────────────────────────┤
│ FOOTER (sticky bottom, blur bg)                   │
│   ──── ЛИБО ────                                  │
│   TaskDrawerComposer (см. ниже)                   │
│   ──── ЛИБО ────                                  │
│   ⛔ Отменить работу  (только in_progress)         │
└───────────────────────────────────────────────────┘
```

CSS-приём для header/body/footer: внешний div `display: grid;
grid-template-rows: auto minmax(0,1fr) auto;`. То же что в текущем
[TaskDialog](client/src/presentation/components/tasks/TaskDialog.tsx#L240),
только в side-варианте.

### Header

- **Левый верх:** кнопка expand-toggle (`Maximize2/Minimize2`), затем
  breadcrumb `PROJECT-NAME · [shortId]`.
- **Правый верх:** статус-бейдж (`STATUS_LABEL[task.status]`) →
  `TaskRalphModeChip` (только если есть смысл — см. ниже) → `X` close.
  - Ralph-mode chip показывается ТОЛЬКО когда статус ∈ `{backlog, todo,
    awaiting_clarification}`. В `done` и `in_progress` — скрыт (бессмысленно
    менять режим у завершённой или активной задачи; для in_progress backend
    всё равно проигнорирует, runner уже забрал mode на claim).
- **Одно-строчный preview:** `<p className="line-clamp-1">{task.description}</p>`.
  В backlog — `<button>` с переходом в inline-edit (открывает в body
  `TaskDescriptionEditor` уже в режиме editing). В остальных статусах —
  просто текст.
- **Attachment-row:** новый компонент `TaskDrawerAttachmentRow`. Принимает
  `items: TaskAttachment[]` и `canEdit: boolean`. Рендерит горизонтально
  скроллящийся `<div className="flex overflow-x-auto gap-1.5">` с
  `AttachmentThumb`-чипами 32×32. Клик по чипу → `AttachmentLightbox` (уже
  есть в [client/src/presentation/components/attachments/AttachmentLightbox.tsx](client/src/presentation/components/attachments/AttachmentLightbox.tsx)).
  При `canEdit` — в конце ряда кнопка `+` (file-picker), drag-drop поверх
  всего drawer'а добавляет файл в эту секцию.

### Body

Тот же контент что сегодня в TaskDialog, минус два пункта:

- `TaskDescriptionEditor` — если `task.status === 'backlog'` или режим
  inline-edit включён через клик в header'е. В прочих статусах — статичный
  `<p whitespace-pre-wrap>{task.description}</p>`.
- `AttachmentsSection` — рендерим в body только в backlog (там грид с
  add/remove). В остальных статусах вся работа с аттачами идёт через header-row
  + lightbox.
- `TaskCommentsSection` — оставляем как сегодня, но **удаляем** из него
  встроенный `CommentComposer` (внутренний вызов в конце JSX). Композер
  переезжает в footer drawer'а.
- `TaskCommitsSection` — без изменений.

### Footer — TaskDrawerComposer (новый компонент)

Заменяет старый `CommentComposer` из TaskDialog.

Локальный state:
- `body: string` — текст комментария.
- `pending: PendingFile[]` — приложенные файлы (как сегодня).
- `target: 'draft' | 'worker'` — выбор переключателя. Default читается из
  `localStorage.getItem('taskComposerTarget:' + projectId)`, fallback 'draft'.
  При смене — пишется обратно.
- `submitting: boolean`.

Render-skeleton:

```
┌──────────────────────────────────────────┐
│ pending-files row (если есть)            │
├──────────────────────────────────────────┤
│ textarea «Написать комментарий…»         │
├──────────────────────────────────────────┤
│ 📎          [В черновики ▎Воркеру] Send  │
└──────────────────────────────────────────┘
```

Segmented control `[В черновики ▎Воркеру]` = две `<button>` с
`role="radio"`, ARIA-keyboard left/right. Активный — заполненный фон, неактивный
— transparent. Полная ширина не нужна — компактный 2-сегментный, лёгкий
inline.

**Submit:**
1. Если `body.trim() === '' && pending.length === 0` → no-op (как сегодня).
2. Resolve `targetStatus`:
   - `target === 'draft'` → `'backlog'`
   - `target === 'worker'` → `'todo'`
3. `await taskRepository.createComment(projectId, taskId, body || ' ')`.
4. Upload pending → `taskRepository.uploadCommentAttachment(...)` в цикле.
5. Если `task.status !== targetStatus` → `await taskRepository.move(...)`
   с `beforeTaskId=null, afterTaskId=<первая в целевой колонке>` (в начало) либо
   `beforeTaskId=<последняя>, afterTaskId=null` (в конец). Выбираем «в конец»
   как менее агрессивное по очереди — это user-action, не приоритетный кейс.
6. Обновить родительский state (callback `onCommentCreated` + `onCommitsChange`).
7. Очистить локальный state.

**Hide-rule:** компонент `TaskDrawerComposer` не рендерится если
`task.status === 'in_progress'`. Вместо него — `CancelWorkButton`.

**Toggle behaviour table:**

| Текущий статус | target = draft | target = worker |
|---|---|---|
| `backlog` | no move (уже там) | move → `todo` |
| `todo` | move → `backlog` | no move (уже там) |
| `awaiting_clarification` | move → `backlog` | move → `todo` |
| `done` | move → `backlog` | move → `todo` (re-open) |
| `in_progress` | — (композер скрыт) | — |

### Footer — CancelWorkButton (новый компонент)

Только при `task.status === 'in_progress'`. Full-width destructive button,
lucide-иконка `Octagon`, текст «Отменить работу».

**Onclick flow:**
1. `window.confirm('Остановить выполнение и вернуть задачу в черновики?')`
   (или shadcn `AlertDialog` — см. open-вопрос). Без confirm — нет.
2. Try-catch вокруг трёх вызовов:
   - Если `task.agentJob && task.agentJob.status in {queued, running}`:
     `await cancelAgentJob.execute(projectId, task.agentJob.id)`. Если уже
     `succeeded/failed/cancelled` — пропускаем (cancellAgentJob кинет
     `AgentJobNotCancellableError`).
   - `await taskRepository.move(projectId, taskId, { targetStatus: 'backlog',
     beforeTaskId: <id последней задачи в backlog или null>, afterTaskId: null })`
     — двигаем в конец колонки backlog. `update()` принимает только
     `{description, ralphMode}` (см. [TaskRepository.ts#L13-L16](client/src/application/task/TaskRepository.ts#L13-L16)),
     поэтому статус меняется именно через `move()`. Список соседей берём из
     уже загруженных tasks в родителе (`KanbanBoard` прокидывает через
     `onCancelWork` callback).
   - `await taskRepository.createComment(projectId, taskId, 'Отменено пользователем')`.
     **Решение:** оставляем actorKind=user — `createComment` всегда пишет
     comment'ы автора. Server'ный `actorKind=system` требует отдельный
     endpoint, которого нет; заводить ради одного UI-кейса избыточно.
3. Toast «Работа отменена, задача в черновиках».
4. `onCommitsChange()` родителя — он перефетчит board и закроет drawer (или
   нет, на выбор; чаще — оставит drawer открытым на той же задаче с новым
   статусом).

**Edge-cases:**
- Если задача в `in_progress` без `agentJob` (легаси / ручной переход) —
  cancelAgentJob skipим, статус двигаем как обычно.
- Если cancelAgentJob упал с `AgentJobNotCancellableError` (race с
  succeeded/failed) — глотаем ошибку, продолжаем с move+comment.
- Другие ошибки — toast.error + abort.

## Status labels: единый источник

Новый файл `client/src/presentation/components/tasks/statusLabels.ts`:

```ts
import type { TaskStatus } from '@/domain/task/Task';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'ЧЕРНОВИКИ',
  todo: 'ВОРКЕР',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};

// Подпись под лейблом — мелким серым. Сейчас только для todo (ВОРКЕР • Claude Opus).
export const STATUS_SUBTITLE: Partial<Record<TaskStatus, string>> = {
  todo: 'Claude Opus',
};
```

**Где используется:**
- `KanbanBoard.tsx` — удаляем локальный `COLUMN_LABELS`, импортим
  `STATUS_LABEL`. Видимые колонки `['backlog','todo','done']` — без изменений.
- `KanbanColumn.tsx` — в header'е добавляем `<p>` с `STATUS_SUBTITLE[status]`
  если есть. Для todo — над/под основным `<h3>` рисуется мелкая подпись «Claude
  Opus».
- `KanbanCard.tsx` — бейджи `in_progress` / `awaiting_clarification` берут
  текст из `STATUS_LABEL` вместо захардкоженных строк.
- `TaskDrawer` — статус-бейдж в header'е использует `STATUS_LABEL`.

**Что НЕ переименовываем:**
- Доменный enum `TaskStatus` ([client/src/domain/task/Task.ts#L6](client/src/domain/task/Task.ts#L6)) — остаётся.
- Любые server-side / БД / API / MCP / realtime поля — `backlog/todo/...` нетронуты.
- Стрелка «промоут» с карточки backlog ([KanbanCard onQuickPromote](client/src/presentation/components/tasks/KanbanCard.tsx#L196-L200)):
  `aria-label`/`title` меняем с «Перенести в TODO» на «Передать воркеру»
  (cosmetic, без логики).

## Файлы

**Новые:**
- `client/src/presentation/components/tasks/TaskDrawer.tsx` — переименование +
  переработка `TaskDialog.tsx`.
- `client/src/presentation/components/tasks/TaskDrawerComposer.tsx` — sticky
  bottom композер с toggle.
- `client/src/presentation/components/tasks/CancelWorkButton.tsx` — кнопка
  отмены для in_progress.
- `client/src/presentation/components/tasks/TaskDrawerAttachmentRow.tsx` —
  горизонтальный ряд аттачей в header'е.
- `client/src/presentation/components/tasks/statusLabels.ts` — единый источник
  лейблов.

**Изменённые:**
- `client/src/presentation/components/tasks/TaskDialog.tsx` — удаляется (или
  rename в TaskDrawer.tsx).
- `client/src/presentation/components/tasks/KanbanBoard.tsx` — заменить
  `TaskDialog` импорт на `TaskDrawer`, импортить `STATUS_LABEL`, переименовать
  `COLUMN_LABELS` → импорт.
- `client/src/presentation/components/tasks/KanbanColumn.tsx` — поддержка
  `STATUS_SUBTITLE` в header'е колонки.
- `client/src/presentation/components/tasks/KanbanCard.tsx` — статус-бейджи
  через `STATUS_LABEL`; aria-label «Перенести в TODO» → «Передать воркеру».

**Не трогаем:** server/, db/, mcp-server/, domain/, application/,
infrastructure/repositories.

## Open questions

1. **Confirm-диалог для «Отменить работу»:** `window.confirm()` (cheap, как в
   текущих delete-flow [KanbanBoard.tsx#L257](client/src/presentation/components/tasks/KanbanBoard.tsx#L257))
   vs. shadcn `AlertDialog` (более «нативно» для UI-проекта, но новая
   зависимость). **Принимаем `window.confirm`** для консистентности с
   существующим delete-flow; AlertDialog — отдельный рефакторинг при желании.

2. **localStorage-persist toggle target:** хранить ли выбор `draft/worker` в
   localStorage с ключом по projectId? **Принимаем — да**, ключ
   `pf.taskComposer.target.<projectId>`; затраты минимальные, UX заметно
   лучше при частых однотипных action'ах.

3. **`actorKind='system'` для комментариев «Отменено»** — НЕ заводим новый
   endpoint, оставляем как user-комментарий (см. секцию CancelWorkButton).

## Out of scope

- Любые изменения backend / БД.
- Любые изменения MCP-tool'ов.
- Drag-drop reordering на mobile (отдельный вопрос).
- Realtime-синхронизация изменений drawer'а от других клиентов (отдельный
  большой вопрос; пока работаем только с локальным refetch).
- Изменение визуала карточек на board'е сверх замены текста статус-бейджей.

## Success criteria

- Клик по карточке открывает drawer справа (half-width на desktop, full-width
  на mobile).
- В backlog: можно редактировать описание, добавлять/удалять файлы; toggle
  «В черновики» дефолтен, «Воркеру» переносит задачу в todo.
- В todo / awaiting_clarification / done: описание и аттачи read-only;
  composer работает, toggle меняет статус согласно таблице выше.
- В in_progress: composer скрыт, видна только кнопка «Отменить работу».
  Confirm → отмена agent-job → задача в backlog → системный комментарий.
- Header drawer'а sticky, аттачи и заголовок видны при скролле body.
- Footer drawer'а sticky.
- Expand-toggle переключает ширину; на mobile скрыт.
- Колонки на board'е: «ЧЕРНОВИКИ», «ВОРКЕР» + «Claude Opus», «Готово».
- ESLint и `npm run typecheck` чистые.
