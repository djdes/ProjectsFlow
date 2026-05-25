# Task Drawer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить центральную модалку задачи на side-drawer (shadcn Sheet) c sticky header / scrollable body / sticky footer. Добавить sticky-композер с переключателем «В черновики / Воркеру», кнопку «Отменить работу» для in_progress, read-only режим вне backlog, визуальный rename статусов колонок.

**Architecture:** Только client/ (presentation-слой Clean Architecture). Доменный enum `TaskStatus`, server-API, БД, MCP — нетронуты. Все статусные переходы через существующие `TaskRepository.move()` и `cancelAgentJob.execute()`. Один новый «системный» комментарий «Отменено пользователем» пишется как обычный user-комментарий.

**Tech Stack:** Vite + React 19 + TypeScript + Tailwind + shadcn/ui · @radix-ui/react-dialog (Sheet) · lucide-react · motion/react.

**Spec:** [2026-05-25-task-drawer-redesign-design.md](../specs/2026-05-25-task-drawer-redesign-design.md)

**Замечания по среде исполнения:**
- Корневая директория — `c:\www\ProjectsFlow`. Все пути относительны ей.
- Платформа — Windows + PowerShell. npm-скрипты cross-platform.
- Тестов нет в проекте (см. plan-конвенцию из 2026-05-21-kanban-agent-runner-plan-b.md). Каждая задача завершается `npm run typecheck` + `npm run lint` + ручной smoke в браузере.
- UI/доки — на русском, код/комментарии в коде — на английском.

---

## File Structure

### Новые файлы

```
client/src/presentation/components/tasks/
  statusLabels.ts                       — единый источник лейблов колонок и бейджей
  TaskDrawer.tsx                        — переработанный TaskDialog (rename + Sheet)
  TaskDrawerComposer.tsx                — sticky-композер с toggle [В черновики ▎Воркеру]
  TaskDrawerAttachmentRow.tsx           — горизонтальный ряд аттачей в header'е
  CancelWorkButton.tsx                  — кнопка отмены для in_progress
```

### Изменяемые файлы

```
client/src/presentation/components/tasks/
  KanbanBoard.tsx                       — импорт STATUS_LABEL вместо локального COLUMN_LABELS; TaskDialog→TaskDrawer
  KanbanColumn.tsx                      — рендер STATUS_SUBTITLE под основным лейблом
  KanbanCard.tsx                        — статус-бейджи через STATUS_LABEL; aria-label «Перенести в TODO»→«Передать воркеру»
```

### Удаляемые файлы

```
client/src/presentation/components/tasks/
  TaskDialog.tsx                        — заменяется на TaskDrawer.tsx (rename)
```

---

## Task 1: statusLabels.ts — единый источник лейблов

**Files:**
- Create: `client/src/presentation/components/tasks/statusLabels.ts`

- [ ] **Step 1: Создать файл `statusLabels.ts`**

```ts
import type { TaskStatus } from '@/domain/task/Task';

// Visual-only label for kanban column header, status badge, in-card chip.
// The domain enum keeps `backlog/todo/...`; this is the user-facing rename.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'ЧЕРНОВИКИ',
  todo: 'ВОРКЕР',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};

// Optional small subtitle rendered under the main label in column header.
// Currently only for `todo` (ВОРКЕР · Claude Opus). null/undefined = no subtitle.
export const STATUS_SUBTITLE: Partial<Record<TaskStatus, string>> = {
  todo: 'Claude Opus',
};
```

- [ ] **Step 2: Запустить typecheck**

Run: `npm run typecheck`
Expected: PASS (новый файл без зависимостей кроме TaskStatus).

- [ ] **Step 3: Commit**

```
git add client/src/presentation/components/tasks/statusLabels.ts
git commit -m "feat(tasks): statusLabels.ts — единый источник UI-лейблов колонок"
```

---

## Task 2: KanbanBoard — заменить COLUMN_LABELS на STATUS_LABEL

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanBoard.tsx:37-47`

- [ ] **Step 1: Удалить локальный `COLUMN_LABELS`, импортнуть `STATUS_LABEL`**

В верхушке файла, рядом с другими импортами:

```ts
import { STATUS_LABEL } from './statusLabels';
```

Удалить блок строк 37–47 (`const COLUMN_LABELS: Record<TaskStatus, string> = { ... }`).

- [ ] **Step 2: Найти использование и заменить**

В JSX (примерно строка 304) — `label={COLUMN_LABELS[status]}` → `label={STATUS_LABEL[status]}`.

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Никаких ссылок на `COLUMN_LABELS` не осталось.

- [ ] **Step 4: Commit**

```
git add client/src/presentation/components/tasks/KanbanBoard.tsx
git commit -m "refactor(tasks): KanbanBoard использует STATUS_LABEL из statusLabels.ts"
```

---

## Task 3: KanbanColumn — добавить подпись STATUS_SUBTITLE

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanColumn.tsx`

- [ ] **Step 1: Импорт STATUS_SUBTITLE**

В верхушке файла:

```ts
import { STATUS_SUBTITLE } from './statusLabels';
```

- [ ] **Step 2: Изменить header колонки (строки 49–72)**

Текущий header:

```tsx
<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
  <div className="flex items-center gap-2">
    {label.length > 0 && (
      <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </h3>
    )}
    <span className="rounded-full bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
      {tasks.length}
    </span>
  </div>
  ...
```

Заменить на:

```tsx
<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
  <div className="flex min-w-0 items-center gap-2">
    {label.length > 0 && (
      <div className="min-w-0">
        <h3 className="truncate text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </h3>
        {STATUS_SUBTITLE[status] && (
          <p className="truncate text-[10px] leading-tight text-muted-foreground/60">
            {STATUS_SUBTITLE[status]}
          </p>
        )}
      </div>
    )}
    <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
      {tasks.length}
    </span>
  </div>
  ...
```

(Остальной header — без изменений.)

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Запустить dev-server и проверить визуально**

Run: `npm run dev:client`
Открыть проектную страницу с board'ом. Убедиться:
- Колонка backlog: header «ЧЕРНОВИКИ» без подписи.
- Колонка todo: header «ВОРКЕР» + ниже мелким «Claude Opus».
- Колонка done: «Готово» без подписи.

- [ ] **Step 5: Commit**

```
git add client/src/presentation/components/tasks/KanbanColumn.tsx
git commit -m "feat(tasks): подпись STATUS_SUBTITLE под лейблом колонки (todo → Claude Opus)"
```

---

## Task 4: KanbanCard — статус-бейджи через STATUS_LABEL + переименовать aria

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanCard.tsx`

- [ ] **Step 1: Импорт STATUS_LABEL**

```ts
import { STATUS_LABEL } from './statusLabels';
```

- [ ] **Step 2: Заменить захардкоженные строки в бейджах (строки 156–169)**

Текущий код:

```tsx
{task.status === 'in_progress' && (
  <span className="ml-auto flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
    <span aria-hidden className="size-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
    В&nbsp;работе
  </span>
)}
{task.status === 'awaiting_clarification' && (
  <span className="ml-auto flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
    <ClaudeIcon className="size-3" />
    На&nbsp;уточнении
  </span>
)}
```

Заменить на:

```tsx
{task.status === 'in_progress' && (
  <span className="ml-auto flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
    <span aria-hidden className="size-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
    {STATUS_LABEL.in_progress}
  </span>
)}
{task.status === 'awaiting_clarification' && (
  <span className="ml-auto flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
    <ClaudeIcon className="size-3" />
    {STATUS_LABEL.awaiting_clarification}
  </span>
)}
```

(Эмодзи 🤔 уже в STATUS_LABEL.awaiting_clarification — рендерится встроенно.)

- [ ] **Step 3: Переименовать aria/title на кнопке quick-promote (строки 196–199)**

Текущий код:

```tsx
aria-label="Перенести в TODO"
title="Перенести в TODO"
```

Заменить на:

```tsx
aria-label="Передать воркеру"
title="Передать воркеру"
```

- [ ] **Step 4: typecheck + lint + dev smoke**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

В browser'е проверить hover-tooltip на стрелке `→` на карточке в backlog-колонке: показывает «Передать воркеру».

- [ ] **Step 5: Commit**

```
git add client/src/presentation/components/tasks/KanbanCard.tsx
git commit -m "refactor(tasks): KanbanCard бейджи через STATUS_LABEL; quick-promote → «Передать воркеру»"
```

---

## Task 5: TaskDrawer — rename TaskDialog → TaskDrawer + переход на Sheet (без layout-изменений)

Цель этой задачи — **только** механический переход с `Dialog` на `Sheet` без структурных изменений тела. Layout остаётся текущим (просто рендерится справа), композер по-прежнему внутри body. Sticky header/footer и новый композер — в следующих задачах.

**Files:**
- Create: `client/src/presentation/components/tasks/TaskDrawer.tsx` (копия TaskDialog.tsx с правками)
- Modify: `client/src/presentation/components/tasks/KanbanBoard.tsx` (импорт)
- Delete: `client/src/presentation/components/tasks/TaskDialog.tsx`

- [ ] **Step 1: Создать TaskDrawer.tsx копированием TaskDialog.tsx**

```powershell
Copy-Item client/src/presentation/components/tasks/TaskDialog.tsx client/src/presentation/components/tasks/TaskDrawer.tsx
```

- [ ] **Step 2: В TaskDrawer.tsx заменить импорт Dialog на Sheet**

Старая строка:

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
```

Заменить на:

```tsx
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
```

(SheetFooter в sheet.tsx нет — будем использовать обычный div, см. ниже.)

- [ ] **Step 3: Переименовать тип и компонент**

Заменить все вхождения (case-sensitive):
- `TaskDialogState` → `TaskDrawerState` (тип, экспортируется)
- `export function TaskDialog(` → `export function TaskDrawer(`
- `id="task-dialog-form"` → `id="task-drawer-form"`

- [ ] **Step 4: Заменить JSX `<Dialog>` на `<Sheet>` с side="right"**

Найти блок (примерно строки 234–360):

```tsx
return (
  <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-3xl">
      <DialogHeader className="px-6 pb-2 pt-4">
        ...
      </DialogHeader>
      <form ...>...</form>
      <DialogFooter className="border-t bg-background px-6 py-4">
        ...
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
```

Заменить на:

```tsx
return (
  <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
    <SheetContent
      side="right"
      className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[640px]"
    >
      <SheetHeader className="px-6 pb-2 pt-4">
        ...
      </SheetHeader>
      <form ...>...</form>
      <div className="border-t bg-background px-6 py-4 flex justify-end gap-2">
        ...{/* (содержимое бывшего DialogFooter — оставить как есть, кнопки Cancel/Submit) */}...
      </div>
    </SheetContent>
  </Sheet>
);
```

Внутри SheetHeader заменить `DialogTitle` → `SheetTitle`, `DialogDescription` → `SheetDescription`.

- [ ] **Step 5: В KanbanBoard.tsx обновить импорт**

Старая строка:

```tsx
import { TaskDialog, type TaskDialogState } from './TaskDialog';
```

Заменить на:

```tsx
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';
```

Найти и заменить во всём файле:
- `TaskDialogState` → `TaskDrawerState`
- `<TaskDialog` → `<TaskDrawer`

- [ ] **Step 6: Удалить TaskDialog.tsx**

```powershell
Remove-Item client/src/presentation/components/tasks/TaskDialog.tsx
```

- [ ] **Step 7: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Если есть ошибки про неиспользуемые импорты или missing exports — исправить (например, удалить неиспользуемый импорт `DialogFooter` если он где-то остался).

- [ ] **Step 8: Dev smoke**

Run: `npm run dev:client`
Открыть проект. Кликнуть на любую задачу. Ожидаемо:
- Открывается панель справа (slide-in).
- Высота — полный viewport.
- Контент внутри прежний (description, аттачи, комментарии, коммиты).
- Esc или клик мимо — закрывает.

- [ ] **Step 9: Commit**

```
git add -A
git commit -m "refactor(tasks): TaskDialog → TaskDrawer на shadcn Sheet (side=right)"
```

---

## Task 6: TaskDrawer — добавить локальный state `expanded` + кнопку expand/collapse

**Files:**
- Modify: `client/src/presentation/components/tasks/TaskDrawer.tsx`

- [ ] **Step 1: Импортнуть иконки**

В блок импортов из `lucide-react`:

```tsx
import { Download, FileText, Loader2, Maximize2, Minimize2, Paperclip, Pencil, Send, Trash2 } from 'lucide-react';
```

- [ ] **Step 2: Добавить state `expanded` и detection mobile**

В теле `TaskDrawer` (рядом с другими useState'ами):

```tsx
const [expanded, setExpanded] = useState(false);
// На mobile drawer всегда full-width — expand-toggle скрываем.
const isCoarsePointer =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
```

(useState уже импортирован.)

- [ ] **Step 3: Применить ширину к SheetContent через шаблон строки**

```tsx
<SheetContent
  side="right"
  className={cn(
    'grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0',
    expanded ? 'w-screen sm:max-w-none' : 'sm:max-w-[640px]',
  )}
>
```

(`cn` уже импортирован из `@/lib/utils`.)

- [ ] **Step 4: Добавить кнопку expand в header (внутри SheetHeader)**

В верхнем `<div className="flex items-center justify-between gap-3">` слева от projectName-блока добавить:

```tsx
{!isCoarsePointer && (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="size-7 shrink-0"
    onClick={() => setExpanded((v) => !v)}
    aria-label={expanded ? 'Свернуть' : 'Развернуть'}
    title={expanded ? 'Свернуть' : 'Развернуть'}
  >
    {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
  </Button>
)}
```

- [ ] **Step 5: Сбрасывать expanded на close**

В существующем `useEffect` который смотрит на `state`:

```tsx
useEffect(() => {
  if (!state) return;
  setDescription(state.mode === 'edit' ? state.task.description ?? '' : '');
  setCreateRalphMode('normal');
  setError(null);
  setExpanded(false); // ← добавить эту строку
  setPendingFiles((prev) => {
    prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    return [];
  });
}, [state]);
```

- [ ] **Step 6: typecheck + lint + dev smoke**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

В browser'е (desktop):
- Drawer открывается шириной 640px.
- Клик на Maximize2 в шапке: drawer растягивается на всю ширину окна.
- Клик на Minimize2: возвращается к 640px.
- При закрытии и повторном открытии — состояние сбрасывается в неразвёрнутое.

- [ ] **Step 7: Commit**

```
git add client/src/presentation/components/tasks/TaskDrawer.tsx
git commit -m "feat(tasks): expand/collapse drawer на весь экран"
```

---

## Task 7: TaskCommentsSection — извлечь композер в отдельный prop, оставить только список

**Files:**
- Modify: `client/src/presentation/components/tasks/TaskDrawer.tsx`

Цель — отделить «список комментариев» от «отправка нового». Это нужно чтобы в Task 8 композер можно было перенести в footer drawer'а. Делаем максимально консервативно: `TaskCommentsSection` теперь принимает опциональный `renderComposer` prop, а если он не передан — рендерит существующий `<CommentComposer>` (обратная совместимость).

- [ ] **Step 1: Изменить сигнатуру `TaskCommentsSection`**

Найти определение:

```tsx
function TaskCommentsSection({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}): React.ReactElement {
```

Заменить на:

```tsx
function TaskCommentsSection({
  projectId,
  taskId,
  // External composer (footer of TaskDrawer). When provided, the section
  // exposes `onCommentCreated` via this prop instead of rendering an inline
  // composer. The external composer calls back into this through context-free
  // imperative ref OR through state in the parent. See callsite.
  onCommentCreatedRef,
}: {
  projectId: string;
  taskId: string;
  onCommentCreatedRef?: React.MutableRefObject<((c: TaskComment) => void) | null>;
}): React.ReactElement {
```

- [ ] **Step 2: В теле функции экспортнуть `handleCreated` через ref**

После определения `handleCreated`:

```tsx
const handleCreated = (created: TaskComment): void => {
  setComments((prev) => [...prev, created]);
};

// Expose for external composer (footer).
useEffect(() => {
  if (onCommentCreatedRef) {
    onCommentCreatedRef.current = handleCreated;
    return () => {
      onCommentCreatedRef.current = null;
    };
  }
  return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [onCommentCreatedRef]);
```

- [ ] **Step 3: Условно скрыть встроенный CommentComposer**

В JSX заменить:

```tsx
<CommentComposer
  projectId={projectId}
  taskId={taskId}
  members={members}
  onCreated={handleCreated}
/>
```

на:

```tsx
{!onCommentCreatedRef && (
  <CommentComposer
    projectId={projectId}
    taskId={taskId}
    members={members}
    onCreated={handleCreated}
  />
)}
```

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (Внешний композер ещё не зовёт TaskCommentsSection с ref — встроенный композер по-прежнему рендерится; никаких поведенческих изменений.)

- [ ] **Step 5: Commit**

```
git add client/src/presentation/components/tasks/TaskDrawer.tsx
git commit -m "refactor(tasks): TaskCommentsSection экспонирует onCommentCreatedRef для внешнего композера"
```

---

## Task 8: TaskDrawerComposer — новый компонент со сегментным toggle

**Files:**
- Create: `client/src/presentation/components/tasks/TaskDrawerComposer.tsx`

- [ ] **Step 1: Создать файл**

```tsx
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { FileText, Loader2, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '@/domain/task/Task';
import type { TaskComment } from '@/domain/task/TaskComment';
import { useContainer } from '@/infrastructure/di/container';
import {
  extractClipboardFiles,
  isImageMime,
} from '@/presentation/components/attachments/files';

type PendingFile = {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
};

type ComposerTarget = 'draft' | 'worker';

type Props = {
  task: Task;
  // Список соседних задач в целевой колонке backlog/todo — для расчёта
  // beforeTaskId/afterTaskId при move'е. Передаётся из TaskDrawer'а.
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  // Колбэк после успешного создания комментария (и опционально move).
  // Родитель использует его чтобы обновить список комментов и перефетчить board.
  onCommentCreated: (created: TaskComment) => void;
  onTaskChanged: () => void;
};

// Local-storage key для запоминания выбора toggle'а по проекту.
function targetStorageKey(projectId: string): string {
  return `pf.taskComposer.target.${projectId}`;
}

function readTarget(projectId: string): ComposerTarget {
  if (typeof window === 'undefined') return 'draft';
  const raw = window.localStorage.getItem(targetStorageKey(projectId));
  return raw === 'worker' ? 'worker' : 'draft';
}

// Куда move'нуть задачу в зависимости от текущего статуса и выбранного target'а.
// null = двигать не надо (уже там).
function resolveMoveTarget(
  current: TaskStatus,
  target: ComposerTarget,
): TaskStatus | null {
  if (target === 'draft') {
    return current === 'backlog' ? null : 'backlog';
  }
  // target === 'worker'
  return current === 'todo' ? null : 'todo';
}

const TEXTAREA_MAX_PX = 192;

export function TaskDrawerComposer({
  task,
  backlogTail,
  todoTail,
  onCommentCreated,
  onTaskChanged,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [target, setTarget] = useState<ComposerTarget>(() => readTarget(task.projectId));
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-grow textarea — same approach as QuickAddTodo.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [body]);

  // Persist target choice per project.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(targetStorageKey(task.projectId), target);
  }, [task.projectId, target]);

  const addFiles = (raw: FileList | File[]): void => {
    const list = Array.from(raw);
    if (list.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...list.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : '',
      })),
    ]);
  };

  const removeFile = (id: string): void => {
    setPending((prev) => {
      const t = prev.find((p) => p.id === id);
      if (t?.previewUrl) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = extractClipboardFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const submit = async (): Promise<void> => {
    const trimmed = body.trim();
    if ((trimmed.length === 0 && pending.length === 0) || submitting) return;
    setSubmitting(true);
    try {
      // 1. Create comment.
      const created = await taskRepository.createComment(
        task.projectId,
        task.id,
        trimmed || ' ',
      );
      // 2. Upload pending attachments.
      const uploaded = [];
      for (const pf of pending) {
        try {
          uploaded.push(
            await taskRepository.uploadCommentAttachment(
              task.projectId,
              task.id,
              created.id,
              pf.file,
            ),
          );
        } catch (err) {
          toast.error(`Не удалось загрузить ${pf.file.name}: ${(err as Error).message}`);
        }
      }
      onCommentCreated({ ...created, attachments: uploaded });

      // 3. Resolve and apply move.
      const moveTo = resolveMoveTarget(task.status, target);
      if (moveTo !== null) {
        // Двигаем в конец колонки — тут берём последний task из неё (если есть)
        // как beforeTaskId, иначе both null = в начало пустой колонки.
        const tail = moveTo === 'backlog' ? backlogTail : todoTail;
        await taskRepository.move(task.projectId, task.id, {
          targetStatus: moveTo,
          beforeTaskId: tail?.id ?? null,
          afterTaskId: null,
        });
        onTaskChanged();
        toast.success(
          moveTo === 'todo' ? 'Передано воркеру' : 'Задача в черновиках',
        );
      } else {
        onTaskChanged();
      }

      // 4. Reset.
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      setPending([]);
      setBody('');
    } catch (e) {
      toast.error(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  // Cleanup blob URLs on unmount.
  useEffect(() => {
    return () => {
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = (body.trim().length > 0 || pending.length > 0) && !submitting;

  return (
    <div className="border-t bg-background/95 backdrop-blur-md">
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b bg-muted/30 px-3 py-1.5">
          {pending.map((pf) => (
            <span
              key={pf.id}
              className="inline-flex items-center gap-1.5 rounded border bg-background py-0.5 pl-1.5 pr-1 text-[11px]"
              title={pf.file.name}
            >
              {pf.previewUrl ? (
                <img src={pf.previewUrl} alt="" className="size-4 rounded object-cover" />
              ) : (
                <FileText className="size-3.5 text-muted-foreground" />
              )}
              <span className="max-w-[140px] truncate">{pf.file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(pf.id)}
                className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive hover:text-white"
                aria-label="Убрать"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={submitting}
        placeholder="Написать комментарий… Markdown, файлы (Ctrl+V)"
        style={{ maxHeight: `${TEXTAREA_MAX_PX}px` }}
        className="block w-full resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
      />

      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting}
          aria-label="Прикрепить файл"
          title="Прикрепить файл (или Ctrl+V)"
        >
          <Paperclip className="size-3.5" />
        </Button>

        <div className="flex items-center gap-1.5">
          {/* Segmented toggle [В черновики ▎Воркеру] */}
          <div
            role="radiogroup"
            aria-label="Куда отправить задачу при отправке"
            className="inline-flex items-center rounded-md border bg-muted/40 p-0.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={target === 'draft'}
              onClick={() => setTarget('draft')}
              className={cn(
                'rounded px-2 py-0.5 text-xs transition-colors',
                target === 'draft'
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              В черновики
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={target === 'worker'}
              onClick={() => setTarget('worker')}
              className={cn(
                'rounded px-2 py-0.5 text-xs transition-colors',
                target === 'worker'
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Воркеру
            </button>
          </div>

          <Button
            type="button"
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            onClick={() => void submit()}
            disabled={!canSubmit}
            title="Ctrl+Enter — отправить"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Отправить
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (Компонент создан но ещё не подключён.)

- [ ] **Step 3: Commit**

```
git add client/src/presentation/components/tasks/TaskDrawerComposer.tsx
git commit -m "feat(tasks): TaskDrawerComposer — sticky-композер с toggle [В черновики ▎Воркеру]"
```

---

## Task 9: CancelWorkButton — кнопка отмены работы для in_progress

**Files:**
- Create: `client/src/presentation/components/tasks/CancelWorkButton.tsx`

- [ ] **Step 1: Создать файл**

```tsx
import { useState } from 'react';
import { Loader2, Octagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Task } from '@/domain/task/Task';
import { AgentJobNotCancellableError } from '@/domain/agentJob/errors';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  task: Task;
  // Последняя задача в backlog — для расчёта beforeTaskId в move().
  backlogTail: { readonly id: string } | null;
  onCancelled: () => void;
};

export function CancelWorkButton({ task, backlogTail, onCancelled }: Props): React.ReactElement {
  const { taskRepository, cancelAgentJob } = useContainer();
  const [busy, setBusy] = useState(false);

  const handleClick = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm('Остановить выполнение и вернуть задачу в черновики?')) return;
    setBusy(true);
    try {
      // 1. Cancel agent-job if cancellable.
      const job = task.agentJob;
      if (job && (job.status === 'queued' || job.status === 'running')) {
        try {
          await cancelAgentJob.execute(task.projectId, job.id);
        } catch (e) {
          // Race: job могла перейти в succeeded/failed между рендером и кликом.
          // В этом случае глотаем ошибку и продолжаем move + comment.
          if (!(e instanceof AgentJobNotCancellableError)) throw e;
        }
      }
      // 2. Move task → backlog (в конец).
      await taskRepository.move(task.projectId, task.id, {
        targetStatus: 'backlog',
        beforeTaskId: backlogTail?.id ?? null,
        afterTaskId: null,
      });
      // 3. Системный (user) комментарий.
      await taskRepository.createComment(
        task.projectId,
        task.id,
        'Отменено пользователем',
      );
      toast.success('Работа отменена, задача в черновиках');
      onCancelled();
    } catch (e) {
      toast.error(`Не удалось отменить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t bg-background/95 px-3 py-3 backdrop-blur-md">
      <Button
        type="button"
        variant="destructive"
        className="w-full gap-2"
        onClick={() => void handleClick()}
        disabled={busy}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Octagon className="size-4" />}
        Отменить работу
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Проверить, что `AgentJobNotCancellableError` экспортируется в client/**

Run: `npm run typecheck`

Если выдаст ошибку «Cannot find module '@/domain/agentJob/errors'» — нужно посмотреть структуру:

```powershell
Get-ChildItem client/src/domain/agentJob/
```

Если файла `errors.ts` нет — заменить логику race-handling на проверку через `(e as Error).message`:

```tsx
} catch (e) {
  // Race: job могла перейти в succeeded/failed между рендером и кликом.
  // Server возвращает 409 c message содержащим "Cannot cancel". Глотаем.
  if (!/cancel/i.test((e as Error).message)) throw e;
}
```

(Этот fallback тривиален и не требует доменных типов на клиенте.)

- [ ] **Step 3: Проверить, что `cancelAgentJob` уже в DI-контейнере**

Run: `grep -n cancelAgentJob client/src/infrastructure/di/container.tsx`

Если уже там (так и должно быть, см. AgentJobBadge.tsx#L30) — продолжаем. Если нет — это блокер, надо чинить отдельной задачей.

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add client/src/presentation/components/tasks/CancelWorkButton.tsx
git commit -m "feat(tasks): CancelWorkButton — отмена работы in_progress задачи"
```

---

## Task 10: TaskDrawerAttachmentRow — горизонтальный ряд аттачей для header'а

**Files:**
- Create: `client/src/presentation/components/tasks/TaskDrawerAttachmentRow.tsx`

- [ ] **Step 1: Создать файл**

```tsx
import { useState, useRef } from 'react';
import { FileText, Paperclip, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { isImageMime } from '@/presentation/components/attachments/files';

type Props = {
  items: readonly TaskAttachment[];
  // Если true — рендерим кнопку «+» для добавления файлов через picker.
  canEdit: boolean;
  onAddFiles?: (files: File[]) => void;
};

export function TaskDrawerAttachmentRow({ items, canEdit, onAddFiles }: Props): React.ReactElement | null {
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (items.length === 0 && !canEdit) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pr-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
      {items.map((att) => (
        <button
          key={att.id}
          type="button"
          onClick={() => setPreview(att)}
          className={cn(
            'group/att relative size-8 shrink-0 overflow-hidden rounded border bg-muted',
            'transition-transform hover:scale-105',
          )}
          aria-label={`Открыть ${att.filename}`}
          title={att.filename}
        >
          {isImageMime(att.mimeType) && att.url ? (
            <img src={att.url} alt={att.filename} loading="lazy" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center bg-muted">
              <FileText className="size-3.5 text-muted-foreground" />
            </div>
          )}
        </button>
      ))}

      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="grid size-8 shrink-0 place-items-center rounded border border-dashed text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            aria-label="Добавить файл"
            title="Добавить файл"
          >
            <Plus className="size-3.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && onAddFiles) {
                onAddFiles(Array.from(e.target.files));
              }
              e.target.value = '';
            }}
          />
        </>
      )}

      {items.length === 0 && canEdit && (
        <span className="flex items-center gap-1 pl-1 text-[11px] text-muted-foreground/60">
          <Paperclip className="size-3" />
          нет файлов
        </span>
      )}

      <AttachmentLightbox attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add client/src/presentation/components/tasks/TaskDrawerAttachmentRow.tsx
git commit -m "feat(tasks): TaskDrawerAttachmentRow — горизонтальный ряд аттачей для шапки drawer'а"
```

---

## Task 11: TaskDrawer — переделать header в sticky, перенести композер в footer, read-only вне backlog

Это самая большая задача — собираем drawer'у новый layout с использованием компонентов из Task 7–10.

**Files:**
- Modify: `client/src/presentation/components/tasks/TaskDrawer.tsx`

- [ ] **Step 1: Импортнуть новые компоненты + STATUS_LABEL**

В блок импортов TaskDrawer.tsx добавить:

```tsx
import { TaskDrawerComposer } from './TaskDrawerComposer';
import { TaskDrawerAttachmentRow } from './TaskDrawerAttachmentRow';
import { CancelWorkButton } from './CancelWorkButton';
import { STATUS_LABEL } from './statusLabels';
import { taskShortId, type Task } from '@/domain/task/Task';
```

(тип `Task` уже импортирован — если да, оставь как есть; добавь только `taskShortId`.)

- [ ] **Step 2: Расширить Props TaskDrawer для прокидывания «соседей» из board'а**

В `type Props`:

```tsx
type Props = {
  state: TaskDrawerState | null;
  onClose: () => void;
  onSubmit: (input: { description: string; ralphMode?: import('@/domain/task/Task').RalphMode }) => Promise<Task>;
  onCommitsChange?: () => void;
  showCommits?: boolean;
  projectName?: string;
  // Последние задачи в backlog/todo — для расчёта позиции при move через композер.
  // Передаётся из KanbanBoard (см. Task 12).
  backlogTail?: { readonly id: string } | null;
  todoTail?: { readonly id: string } | null;
};
```

И в сигнатуре:

```tsx
export function TaskDrawer({
  state,
  onClose,
  onSubmit,
  onCommitsChange,
  showCommits = true,
  projectName,
  backlogTail = null,
  todoTail = null,
}: Props): React.ReactElement {
```

- [ ] **Step 3: Добавить ref для onCommentCreated**

В теле компонента рядом с другими useState/useRef:

```tsx
import type { TaskComment } from '@/domain/task/TaskComment';
// ...

const onCommentCreatedRef = useRef<((c: TaskComment) => void) | null>(null);
```

(`useRef` уже импортирован.)

- [ ] **Step 4: Переписать JSX внутри SheetContent (edit-mode)**

Текущая структура (упрощённо):

```tsx
<SheetContent ...>
  <SheetHeader ...>...</SheetHeader>
  <form ...>
    {state?.mode === 'edit' ? (
      <TaskDescriptionEditor ... />
    ) : (
      <textarea ... />
    )}
    {state?.mode === 'edit' ? (
      <>
        <AttachmentsSection ... />
        <div className="border-t pt-4">
          <TaskCommentsSection ... />
        </div>
        {showCommits && <TaskCommitsSection ... />}
      </>
    ) : (
      <>...</>
    )}
  </form>
  <div className="border-t ...">...</div>
</SheetContent>
```

Для **edit-mode** разделить на три region'а (header / scrollable body / footer). Create-mode (новая задача) оставить **как есть** — компактная форма проще.

Новый JSX внутри SheetContent:

```tsx
<SheetContent
  side="right"
  className={cn(
    'grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0',
    expanded ? 'w-screen sm:max-w-none' : 'sm:max-w-[640px]',
  )}
>
  {state?.mode === 'edit' ? (
    <EditDrawerContent
      state={state}
      expanded={expanded}
      isCoarsePointer={isCoarsePointer}
      onToggleExpand={() => setExpanded((v) => !v)}
      onClose={onClose}
      projectName={projectName}
      showCommits={showCommits}
      backlogTail={backlogTail}
      todoTail={todoTail}
      onCommitsChange={onCommitsChange}
      onCommentCreatedRef={onCommentCreatedRef}
      attachmentsRef={attachmentsRef}
    />
  ) : (
    <CreateDrawerContent
      state={state}
      description={description}
      setDescription={setDescription}
      descRef={descRef}
      saving={saving}
      error={error}
      pendingFiles={pendingFiles}
      addPendingFiles={addPendingFiles}
      setPendingFiles={setPendingFiles}
      createRalphMode={createRalphMode}
      setCreateRalphMode={setCreateRalphMode}
      projectName={projectName}
      handleSubmit={handleSubmit}
      onClose={onClose}
      expanded={expanded}
      isCoarsePointer={isCoarsePointer}
      onToggleExpand={() => setExpanded((v) => !v)}
    />
  )}
</SheetContent>
```

(SheetTitle/SheetDescription `sr-only` уезжают в каждый из двух внутренних компонентов — обязательно для a11y Radix.)

Объявить `EditDrawerContent` и `CreateDrawerContent` ниже в том же файле — они будут локальными компонентами. Это разделит файл на читаемые куски.

- [ ] **Step 5: Реализовать `EditDrawerContent`**

В TaskDrawer.tsx ниже `TaskDrawer` функции добавить:

```tsx
function EditDrawerContent({
  state,
  expanded,
  isCoarsePointer,
  onToggleExpand,
  onClose,
  projectName,
  showCommits,
  backlogTail,
  todoTail,
  onCommitsChange,
  onCommentCreatedRef,
  attachmentsRef,
}: {
  state: { mode: 'edit'; task: Task };
  expanded: boolean;
  isCoarsePointer: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  projectName?: string;
  showCommits: boolean;
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  onCommitsChange?: () => void;
  onCommentCreatedRef: React.MutableRefObject<((c: TaskComment) => void) | null>;
  attachmentsRef: React.RefObject<AttachmentsHandle | null>;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);

  const task = state.task;
  const canEdit = task.status === 'backlog';

  // Load attachments for header-row + body-section.
  // (AttachmentsSection load'ит свой собственный список — здесь дублируем для header-row;
  // обе секции расходятся в локальных state'ах, что окей: при upload через add-кнопку
  // в header'е мы синкаем оба через addAttachmentToHeader.)
  useEffect(() => {
    let cancelled = false;
    taskRepository
      .listAttachments(task.projectId, task.id)
      .then((list) => {
        if (!cancelled) setAttachments(list);
      })
      .catch(() => {
        // tolerate — иконки в header'е не критичны
      });
    return () => {
      cancelled = true;
    };
  }, [task.projectId, task.id, taskRepository]);

  const handleAddFilesFromHeader = (files: File[]): void => {
    // Делегируем upload в AttachmentsSection через ref — она уже хранит canonical state.
    void attachmentsRef.current?.addFiles(files);
    // Оптимистично — добавим как pending в header-row не будем (сложно); пусть AttachmentsSection
    // отработает и onCommitsChange отрефетчит сверху, тогда заново загрузим в эффекте.
    // Но мы НЕ перезагружаем при каждом onCommitsChange — это board-level callback. Поэтому
    // делаем простую вещь: на add просто заново фетчим attachments после короткой задержки.
    setTimeout(() => {
      void taskRepository.listAttachments(task.projectId, task.id).then(setAttachments);
    }, 300);
  };

  const renderStatusBadge = (): React.ReactElement => {
    const colorMap: Record<Task['status'], string> = {
      backlog: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
      todo: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      in_progress: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      awaiting_clarification: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      done: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
    };
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
          colorMap[task.status],
        )}
      >
        {STATUS_LABEL[task.status]}
      </span>
    );
  };

  return (
    <>
      {/* === STICKY HEADER === */}
      <div className="border-b bg-background/95 backdrop-blur-md">
        <SheetTitle className="sr-only">
          Задача{projectName ? ` · ${projectName}` : ''}
        </SheetTitle>
        <SheetDescription className="sr-only">Редактирование задачи</SheetDescription>

        <div className="flex items-center gap-2 px-4 pt-3">
          {!isCoarsePointer && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={onToggleExpand}
              aria-label={expanded ? 'Свернуть' : 'Развернуть'}
              title={expanded ? 'Свернуть' : 'Развернуть'}
            >
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {projectName && (
              <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {projectName}
              </span>
            )}
            <span className="font-mono text-[10px] opacity-50">[{taskShortId(task.id)}]</span>
          </div>
          {renderStatusBadge()}
          {(task.status === 'backlog' ||
            task.status === 'todo' ||
            task.status === 'awaiting_clarification') && (
            <TaskRalphModeChip task={task} onChanged={() => onCommitsChange?.()} />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* One-line preview of description */}
        {task.description && task.description.trim().length > 0 && (
          <p className="line-clamp-1 px-4 pt-2 text-sm text-muted-foreground">
            {task.description}
          </p>
        )}

        {/* Attachment row */}
        <div className="px-4 py-2">
          <TaskDrawerAttachmentRow
            items={attachments}
            canEdit={canEdit}
            onAddFiles={handleAddFilesFromHeader}
          />
        </div>
      </div>

      {/* === SCROLLABLE BODY === */}
      <div className="space-y-4 overflow-y-auto px-6 py-4">
        {canEdit ? (
          <TaskDescriptionEditor
            key={task.id}
            projectId={task.projectId}
            taskId={task.id}
            initialDescription={task.description ?? ''}
            onSaved={() => onCommitsChange?.()}
          />
        ) : (
          <div className="whitespace-pre-wrap rounded-md border border-dashed border-transparent p-2 text-sm leading-snug">
            {task.description?.trim() || (
              <span className="italic text-muted-foreground">Без описания</span>
            )}
          </div>
        )}

        {canEdit && (
          <AttachmentsSection
            ref={attachmentsRef}
            projectId={task.projectId}
            taskId={task.id}
            onChange={() => onCommitsChange?.()}
          />
        )}

        <div className="border-t pt-4">
          <TaskCommentsSection
            projectId={task.projectId}
            taskId={task.id}
            onCommentCreatedRef={onCommentCreatedRef}
          />
        </div>

        {showCommits && (
          <div className="border-t pt-4">
            <TaskCommitsSection task={task} onChange={() => onCommitsChange?.()} />
          </div>
        )}
      </div>

      {/* === STICKY FOOTER === */}
      {task.status === 'in_progress' ? (
        <CancelWorkButton
          task={task}
          backlogTail={backlogTail}
          onCancelled={() => onCommitsChange?.()}
        />
      ) : (
        <TaskDrawerComposer
          task={task}
          backlogTail={backlogTail}
          todoTail={todoTail}
          onCommentCreated={(c) => {
            onCommentCreatedRef.current?.(c);
            onCommitsChange?.();
          }}
          onTaskChanged={() => onCommitsChange?.()}
        />
      )}
    </>
  );
}
```

В верхушке файла импортнуть `X` из lucide-react (если ещё не):

```tsx
import { Download, FileText, Loader2, Maximize2, Minimize2, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react';
```

- [ ] **Step 6: Реализовать `CreateDrawerContent`**

(Compact, без sticky-схемы — у новой задачи нет статуса и сущности для footer'а.)

```tsx
function CreateDrawerContent({
  state,
  description,
  setDescription,
  descRef,
  saving,
  error,
  pendingFiles,
  addPendingFiles,
  setPendingFiles,
  createRalphMode,
  setCreateRalphMode,
  projectName,
  handleSubmit,
  onClose,
  expanded,
  isCoarsePointer,
  onToggleExpand,
}: {
  state: { mode: 'create'; status: Task['status'] };
  description: string;
  setDescription: (v: string) => void;
  descRef: (el: HTMLTextAreaElement | null) => void;
  saving: boolean;
  error: string | null;
  pendingFiles: PendingFile[];
  addPendingFiles: (raw: FileList | File[]) => void;
  setPendingFiles: React.Dispatch<React.SetStateAction<PendingFile[]>>;
  createRalphMode: RalphMode;
  setCreateRalphMode: (m: RalphMode) => void;
  projectName?: string;
  handleSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  expanded: boolean;
  isCoarsePointer: boolean;
  onToggleExpand: () => void;
}): React.ReactElement {
  return (
    <>
      <div className="border-b bg-background/95 px-6 pb-2 pt-4 backdrop-blur-md">
        <SheetTitle className="sr-only">
          Новая задача{projectName ? ` · ${projectName}` : ''}
        </SheetTitle>
        <SheetDescription className="sr-only">Создание новой задачи</SheetDescription>
        <div className="flex items-center gap-2">
          {!isCoarsePointer && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={onToggleExpand}
              aria-label={expanded ? 'Свернуть' : 'Развернуть'}
              title={expanded ? 'Свернуть' : 'Развернуть'}
            >
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          )}
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {projectName ? `${projectName} · ` : ''}Новая задача
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-7 shrink-0"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <form
        id="task-drawer-form"
        onSubmit={handleSubmit}
        className="space-y-4 overflow-y-auto px-6 pb-4 pt-4"
      >
        <textarea
          id="task-desc"
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={4}
          placeholder="Что нужно сделать. Контекст, шаги, ссылки. Ctrl+V — картинка пойдёт в аттачи."
          className="block w-full resize-none rounded-md border bg-background p-2 text-sm leading-snug placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:outline-none"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Режим работы Ralph
          </label>
          <RalphModeSelect
            value={createRalphMode}
            onChange={setCreateRalphMode}
            disabled={saving}
          />
        </div>

        <PendingAttachmentsSection
          files={pendingFiles}
          onAdd={addPendingFiles}
          onRemove={(id) => {
            setPendingFiles((prev) => {
              const target = prev.find((p) => p.id === id);
              if (target) URL.revokeObjectURL(target.previewUrl);
              return prev.filter((p) => p.id !== id);
            });
          }}
        />
      </form>

      <div className="flex justify-end gap-2 border-t bg-background px-6 py-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" form="task-drawer-form" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Создать
        </Button>
      </div>
    </>
  );
}
```

(`useState` для `attachments` в EditDrawerContent уже импортирован вверху файла. `useEffect` тоже. `useContainer` — да.)

- [ ] **Step 7: Удалить старый form-paste-handler в TaskDrawer**

Бывший `handleFormPaste` в `TaskDrawer` уже не нужен — paste внутри composer'а ловит сам composer, paste в textarea description'а — браузерный default. Если есть `onPaste={handleFormPaste}` на form'е — удалить вместе с самой функцией.

(Если эта логика по-прежнему нужна для CreateDrawerContent — оставить только её inline.)

- [ ] **Step 8: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

Если падает с предупреждениями про неиспользованные импорты или переменные — почистить.

- [ ] **Step 9: Commit**

```
git add client/src/presentation/components/tasks/TaskDrawer.tsx
git commit -m "feat(tasks): TaskDrawer sticky-layout, read-only вне backlog, footer-композер"
```

---

## Task 12: KanbanBoard — пробросить backlogTail и todoTail в TaskDrawer

**Files:**
- Modify: `client/src/presentation/components/tasks/KanbanBoard.tsx`

- [ ] **Step 1: Вычислить tails**

Найти место где определён `grouped` (примерно строка 139):

```tsx
const grouped = useMemo(() => groupByStatus(tasks, doneOrder), [tasks, doneOrder]);
```

Сразу под ним добавить:

```tsx
// Последняя задача в backlog/todo — нужна для footer-композера в TaskDrawer,
// чтобы посчитать beforeTaskId при move'е через переключатель.
const backlogTail = grouped.backlog[grouped.backlog.length - 1] ?? null;
const todoTail = grouped.todo[grouped.todo.length - 1] ?? null;
```

- [ ] **Step 2: Пробросить в TaskDrawer**

Найти `<TaskDrawer ... />` и добавить новые prop'ы:

```tsx
<TaskDrawer
  state={dialog}
  onClose={() => setDialog(null)}
  onSubmit={handleDialogSubmit}
  onCommitsChange={() => void refetch()}
  showCommits={showCommits}
  projectName={projectName}
  backlogTail={backlogTail}
  todoTail={todoTail}
/>
```

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```
git add client/src/presentation/components/tasks/KanbanBoard.tsx
git commit -m "feat(tasks): KanbanBoard прокидывает backlogTail/todoTail в TaskDrawer"
```

---

## Task 13: Manual smoke + проверка всех статусов

Ручная проверка через `npm run dev:client` в браузере. Никаких автотестов — просто пройти сценарии и убедиться что всё работает.

- [ ] **Step 1: Подготовка — `npm run dev`**

Run: `npm run dev`
Открыть `http://localhost:5173`, залогиниться в тестовом аккаунте, открыть любой проект с board'ом.

- [ ] **Step 2: Сценарий A — Backlog (черновики)**

Клик на карточку в колонке «ЧЕРНОВИКИ».
Ожидаемо:
- Drawer открывается справа, ширина ~640px.
- В header: иконка expand, имя проекта, [shortId], бейдж «ЧЕРНОВИКИ», ralph-chip, X.
- Превью описания одной строкой под header'ом.
- Ряд аттачей с кнопкой «+» в конце.
- Body: редактируемое описание (можно кликнуть → textarea), AttachmentsSection (можно drag-drop / paperclip).
- Footer: композер. Toggle: «В черновики» (default подсвечен), «Воркеру».
- Написать «test draft», нажать Send → коммент создаётся, остаётся в backlog.
- Сменить toggle на «Воркеру», написать «test promote», нажать Send → коммент создаётся, задача уходит в колонку «ВОРКЕР». Toast «Передано воркеру».

- [ ] **Step 3: Сценарий B — TODO/ВОРКЕР**

Кликнуть только что отправленную задачу в колонке «ВОРКЕР».
Ожидаемо:
- Header: бейдж «ВОРКЕР».
- Описание read-only (нет hover-эффекта «нажми чтобы редактировать», cursor — text).
- AttachmentsSection в body НЕ показывается. В header — ряд без кнопки «+».
- Footer: композер, toggle с дефолтом «Воркеру» (из localStorage)... нет, ждать: toggle сохранён ЗА проектом — мы могли его поставить в «Воркеру» в Сценарии A → проверить что и здесь «Воркеру» дефолтен.
- Сменить toggle → «В черновики», написать «back to draft», Send → задача уходит в «ЧЕРНОВИКИ». Toast «Задача в черновиках».

- [ ] **Step 4: Сценарий C — In progress (если в проекте есть активная задача)**

Если у текущего проекта есть задача в статусе in_progress (запущенный agent-job или вручную поставленный) — кликнуть её.
Ожидаемо:
- Header: бейдж «В работе» (зелёный).
- Описание read-only.
- Footer: **нет** композера, **есть** красная кнопка «⛔ Отменить работу».
- Клик → `window.confirm` «Остановить выполнение…».
- Подтвердить → agent-job отменяется (если был), задача уезжает в «ЧЕРНОВИКИ», в комментах появляется «Отменено пользователем». Toast «Работа отменена…».

Если нет задачи в in_progress — пропустить (это требует agent-runner'а; можно вручную через MCP создать на тестовом).

- [ ] **Step 5: Сценарий D — Expand**

В любом drawer'е (desktop).
- Клик на Maximize2 → drawer на всю ширину окна.
- Клик на Minimize2 → возврат к 640px.
- Закрыть-открыть → state сбрасывается, drawer снова 640px.

- [ ] **Step 6: Сценарий E — Колонки и подписи**

Закрыть drawer, посмотреть колонки:
- «ЧЕРНОВИКИ» (без подписи).
- «ВОРКЕР» + ниже мелким «Claude Opus».
- «Готово».

Hover на стрелку `→` на карточке в «ЧЕРНОВИКИ»: tooltip «Передать воркеру».

- [ ] **Step 7: Build check**

Run: `npm run build`
Expected: PASS, без warnings про размер бандла. Если bundle вырос больше чем на 30KB — посмотреть что вошло.

- [ ] **Step 8: Финальный commit (если нужно — fixup'ы)**

Если во время smoke'а нашлось мелкое — мелкими fixup'ами, например:

```
git commit -am "fix(tasks): tweak drawer header spacing on mobile"
```

Если всё прошло чисто — этот шаг skip.

---

## Self-Review

После завершения всех задач:

1. **Spec coverage:**
   - Sheet right side → Task 5 ✓
   - Expand toggle → Task 6 ✓
   - Sticky header / body / footer layout → Task 11 ✓
   - Read-only вне backlog → Task 11 (canEdit logic) ✓
   - Floating composer with toggle → Task 8 + Task 11 (footer wire) ✓
   - Toggle behaviour table → Task 8 (`resolveMoveTarget`) ✓
   - Cancel work button → Task 9 + Task 11 (footer conditional) ✓
   - localStorage persist target → Task 8 (`readTarget` / useEffect persist) ✓
   - STATUS_LABEL / STATUS_SUBTITLE → Task 1 + 2 + 3 + 4 + 11 (status badge) ✓
   - Attachment header row → Task 10 ✓
   - Don't touch domain/server/MCP → out of scope ✓

2. **Placeholder scan:** Все шаги содержат конкретный код или конкретную команду. TBD/«implement later» нет.

3. **Type consistency:** Все типы и сигнатуры — `TaskDrawerState`, `Task`, `TaskComment`, `TaskAttachment` — стандартизированы по доменным типам в `@/domain/task/*`. `cancelAgentJob` из DI уже работает в существующем `AgentJobBadge.tsx`, повторно использован в `CancelWorkButton`.
