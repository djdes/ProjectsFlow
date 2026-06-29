import * as React from 'react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import { ArrowRight, Bot, CalendarClock, ChevronDown, ChevronsRight, Clock, CornerDownRight, Download, FileText, Flag, GripVertical, Loader2, Maximize2, Paperclip, Pencil, Plus, Reply, Send, Trash2, UploadCloud, UserPlus, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { normalizeTaskPropertyOrder, type TaskPropertyKey } from '@/domain/user/UiPrefs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { taskShortId, type Task } from '@/domain/task/Task';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { NotifyAudience, TaskComment } from '@/domain/task/TaskComment';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { NotifyAudienceControl } from '@/presentation/components/tasks/NotifyAudienceControl';
import { CommentActionsMenu } from '@/presentation/components/tasks/CommentActionsMenu';
import { getInitials } from '@/presentation/layout/projectIcons';
import { CommentBody } from './CommentBody';
import {
  parseRalphQuestion,
  answeredQidSet,
  RalphAnswerControls,
} from './RalphQuestionControls';
import { LiveTab } from './LiveTab';
import { ClaudeIcon } from './ClaudeIcon';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import {
  extractClipboardFiles,
  formatBytes,
  isImageFile,
} from '@/presentation/components/attachments/files';
import { RalphModeSelect } from './RalphMode';
import type { RalphMode, TaskStatus } from '@/domain/task/Task';
import { TASK_STATUSES } from '@/domain/task/Task';
import { DelegateSelect } from './DelegateSelect';
import { AssignToProjectSelect } from './AssignToProjectSelect';
import { DelegateTaskButton } from './DelegateTaskButton';
import { DelegationBadge } from './DelegationBadge';
import { DeadlinePicker } from './DeadlinePicker';
import { PrioritySelect } from './PrioritySelect';
import { TaskPriorityChip } from './TaskPriorityChip';
import { TaskDeadlineChip } from './TaskDeadlineChip';
import { PropertyRow, EmptyValue, PROPERTY_VALUE_CLASS } from './PropertyRow';
import { CopyTaskButton } from './CopyTaskButton';
import { ReworkTaskButton } from './ReworkTaskButton';
import { AiComposeDialog } from '@/presentation/components/ai/AiComposeDialog';
import { PlanTaskButton } from './PlanTaskButton';
import { formatTaskCreated } from '@/lib/datetime';
import type { TaskPriority } from '@/domain/task/Task';
import { TaskDrawerComposer } from './TaskDrawerComposer';
import { CommentsEmptyState } from './CommentsEmptyState';
import { TaskBodyEditor } from './TaskBodyEditor';
import { splitTitleBody, parseTitleHeading, stripInlineMarkdown } from '@/lib/taskTitleBody';
import { TaskDrawerAttachmentRow } from './TaskDrawerAttachmentRow';
import { CancelWorkButton } from './CancelWorkButton';
import { STATUS_LABEL } from './statusLabels';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { useResizableWidth } from '@/presentation/hooks/useResizableWidth';
import { AiImproveButton } from '@/presentation/components/ai/AiImproveButton';
import type { MentionMember, RichTextEditorHandle } from '@/presentation/components/editor/RichTextEditor';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

// Tiptap-редактор грузим лениво — он тяжёлый и не нужен на read-heavy экранах,
// которые не открывают drawer. Suspense-fallback держит высоту, чтобы layout не прыгал.
const RichTextEditor = lazy(() =>
  import('@/presentation/components/editor/RichTextEditor').then((m) => ({
    default: m.RichTextEditor,
  })),
);

// Маппинг участников проекта → формат редактора для @-упоминаний (literal `@displayName`).
function toMentionMembers(members: readonly ProjectMember[]): MentionMember[] {
  return members.map((m) => ({ userId: m.userId, displayName: m.user.displayName }));
}

// Контекст ответа/цитаты, выбранный в треде (для плашки в композере).
type ReplyDraft = { commentId: string; authorName: string; quotedText: string | null };

// Найти Range первого вхождения фрагмента внутри элемента (в пределах одного text-node).
function findTextRange(root: HTMLElement, needle: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const idx = (node.textContent ?? '').indexOf(needle);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);
      return range;
    }
    node = walker.nextNode();
  }
  return null;
}

// Прокрутка к комментарию + мягкая вспышка; при наличии quotedText — точечная подсветка
// найденного фрагмента (CSS Custom Highlight API, best-effort; иначе только вспышка).
function flashComment(commentId: string, quotedText?: string | null): void {
  const el = document.getElementById(`comment-${commentId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('pf-comment-flash');
  window.setTimeout(() => el.classList.remove('pf-comment-flash'), 2000);
  const q = (quotedText ?? '').trim();
  if (!q) return;
  const registry = (CSS as unknown as { highlights?: { set(k: string, v: unknown): void; delete(k: string): void } }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  const range = findTextRange(el, q);
  if (!range) return;
  registry.set('pf-quote', new HighlightCtor(range));
  window.setTimeout(() => registry.delete('pf-quote'), 2600);
}

type PendingFile = {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
};

// In-flight аплоад файла (create И edit): имя + прогресс + оценка оставшегося времени.
// Прогресс-бар рисуется ИНЛАЙН в строке «Файлы» (TaskDrawerAttachmentRow), а не плавающим.
type UploadItem = {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  // Момент старта (Date.now()) — для оценки оставшегося времени по скорости.
  readonly startedAt: number;
  // Оценка секунд до конца (null — ещё считаем, 0 — почти готово).
  readonly etaSec: number | null;
};

// Оценка секунд до конца загрузки по средней скорости (первые ~0.4с не оцениваем — шум).
function computeEtaSec(startedAt: number, loaded: number, total: number): number | null {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (loaded > 0 && elapsed > 0.4 && total > loaded) {
    return Math.max(1, Math.round((elapsed / loaded) * (total - loaded)));
  }
  return total > 0 && loaded >= total ? 0 : null;
}

export type TaskDrawerState =
  | { mode: 'create'; status: Task['status'] }
  // scrollToCommentId — deep-link из письма/TG (?task=X#comment-Y): после загрузки
  // комментариев секция скроллит к нему и подсвечивает.
  | { mode: 'edit'; task: Task; scrollToCommentId?: string };

type Props = {
  state: TaskDrawerState | null;
  onClose: () => void;
  // Возвращает созданный/обновлённый task — нужен в create-режиме, чтобы зааплоадить
  // pending-аттачи после получения task.id.
  // ralphMode — режим работы Ralph, который пользователь выбрал в форме (см. RalphModeSelect).
  // Передаётся только в create-mode; в edit-mode смена режима идёт через отдельный PATCH.
  // delegateUserId — опциональное one-to-one делегирование (только inbox-задачи).
  onSubmit: (input: {
    description: string;
    ralphMode?: import('@/domain/task/Task').RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }) => Promise<Task>;
  // Колбэк когда коммиты или аттачи у задачи поменялись — board перефетчит badge'и.
  onCommitsChange?: () => void;
  // Имя проекта — рисуем в шапке диалога как контекстный заголовок. В inbox не передаём.
  projectName?: string;
  // Последние задачи в backlog/todo — нужны для расчёта beforeTaskId при move'е
  // через TaskDrawerComposer и CancelWorkButton. KanbanBoard вычисляет.
  backlogTail?: { readonly id: string } | null;
  todoTail?: { readonly id: string } | null;
  // True когда drawer открыт в контексте inbox-проекта. Включает:
  //  - DelegateSelect в create-mode форме
  //  - AssignToProjectSelect в шапке edit-mode
  isInbox?: boolean;
  // True когда проект совместный (memberCount > 1, но НЕ inbox). Включает
  // блок делегирования (DelegateSelect/DelegateTaskButton) с участниками проекта.
  isShared?: boolean;
  // projectId для AI-кнопки. null = inbox/дефолтный диспетчер; UUID = диспетчер проекта.
  aiProjectId?: string | null;
  // Колбэк для смены статуса задачи (move). Если передан — статус-бейдж кликабелен.
  onMove?: (taskId: string, targetStatus: TaskStatus) => Promise<void>;
  // asPage — рендерить как отдельную страницу (не Sheet-оверлей): без модалки,
  // во всю высоту, с хлебными крошками сверху. Используется на /projects/:id/tasks/:taskId.
  asPage?: boolean;
  // Хлебные крошки для asPage-режима (строит вызывающая страница: проект → задача).
  breadcrumbs?: React.ReactNode;
};

// Обёртка содержимого дровера: в обычном режиме — Sheet-оверлей; в asPage —
// inline-страница во всю высоту с хлебными крошками и центрированной колонкой.
// Объявлена на уровне модуля (стабильный тип) — иначе пересоздание на каждый рендер
// ремонтировало бы всё поддерево (потеря фокуса/состояния редактора).
function DrawerShell({
  asPage,
  breadcrumbs,
  open,
  onOpenChange,
  contentClassName,
  contentStyle,
  dragHandlers,
  dragOverlay,
  children,
}: {
  asPage: boolean;
  breadcrumbs: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentClassName: string;
  contentStyle: React.CSSProperties | undefined;
  // drag&drop вешаем на видимую коробку окна — оверлей покрывает ровно её (любой размер/скролл).
  dragHandlers: {
    onDragEnter: (e: DragEvent<HTMLElement>) => void;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDragLeave: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
  };
  dragOverlay: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  if (asPage) {
    return (
      <div
        className="relative flex h-full w-full flex-col overflow-hidden bg-background"
        {...dragHandlers}
      >
        {dragOverlay}
        <div className="flex min-h-11 shrink-0 items-center px-3 pt-2 sm:px-6">{breadcrumbs}</div>
        <div className="mx-auto grid w-full max-w-3xl flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden">
          {children}
        </div>
      </div>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* SheetContent уже position:fixed → служит containing-block'ом для absolute-оверлея,
          поэтому dragOverlay (absolute inset-0) покрывает ровно видимую коробку окна. */}
      <SheetContent side="right" showClose={false} className={contentClassName} style={contentStyle} {...dragHandlers}>
        {dragOverlay}
        {children}
      </SheetContent>
    </Sheet>
  );
}

// Chip-селектор режима Ralph в edit-mode шапки. Показывает текущий режим бейджем;
// клик раскрывает dropdown для смены — PATCH идёт сразу же (best-effort, error → toast).
// Иконки и подписи строк-свойств по ключу (task 11) — единый источник для порядка.
const PROP_ICON: Record<TaskPropertyKey, LucideIcon> = {
  assignee: UserPlus,
  deadline: CalendarClock,
  priority: Flag,
  mode: Bot,
  files: Paperclip,
  created: Clock,
};
const PROP_LABEL: Record<TaskPropertyKey, string> = {
  assignee: 'Ответственный',
  deadline: 'Дедлайн',
  priority: 'Приоритет',
  mode: 'Режим',
  files: 'Файлы',
  created: 'Создано',
};

// Сортируемая строка свойства (task 11): обёртка dnd-kit вокруг PropertyRow. На hover
// вместо иконки показывается ручка-grip (6 точек), за которую перетаскивают строку.
function SortablePropertyRow({
  id,
  icon,
  label,
  children,
}: {
  id: TaskPropertyKey;
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const handle = (
    <button
      type="button"
      className="grid size-4 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
      aria-label={`Переместить «${label}»`}
      title="Перетащите, чтобы изменить порядок"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10 opacity-80')}>
      <PropertyRow icon={icon} label={label} handle={handle}>
        {children}
      </PropertyRow>
    </div>
  );
}

function TaskRalphModeChip({
  task,
  onChanged,
  className,
  disabled = false,
}: {
  task: Task;
  onChanged: () => void;
  className?: string;
  disabled?: boolean;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [mode, setMode] = useState<RalphMode>(task.ralphMode);
  const [saving, setSaving] = useState(false);

  // Если родитель прислал обновлённую задачу — синкаем локальное состояние.
  useEffect(() => {
    setMode(task.ralphMode);
  }, [task.ralphMode]);

  const change = async (next: RalphMode): Promise<void> => {
    if (next === mode || saving) return;
    const prev = mode;
    setMode(next); // optimistic
    setSaving(true);
    try {
      await taskRepository.update(task.projectId, task.id, { ralphMode: next });
      onChanged();
    } catch (err) {
      setMode(prev);
      toast.error(`Не удалось сменить режим: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // Notion-style чип в ряду свойств шапки: «+ режим» / имя режима + эмодзи + каретка.
  return (
    <RalphModeSelect
      value={mode}
      onChange={(v) => void change(v)}
      disabled={saving || disabled}
      chip
      className={className}
    />
  );
}

// Цепочка «передать дальше»: следующая колонка для кнопки быстрого продвижения
// задачи в шапке дравера (черновики → вручную → воркер → готово).
const ADVANCE_NEXT: Partial<Record<TaskStatus, TaskStatus>> = {
  backlog: 'manual',
  manual: 'todo',
  todo: 'done',
};

// Кнопка «передать в следующую колонку» в шапке edit-mode. Лейбл = имя следующего
// статуса; для статусов вне цепочки (in_progress/awaiting/done) не рендерится.
function TaskAdvanceButton({
  task,
  onMove,
  onChanged,
}: {
  task: Task;
  onMove: (taskId: string, targetStatus: TaskStatus) => Promise<void>;
  onChanged: () => void;
}): React.ReactElement | null {
  const [saving, setSaving] = useState(false);
  const next = ADVANCE_NEXT[task.status];
  if (!next) return null;

  const advance = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await onMove(task.id, next);
      onChanged();
      toast.success(`Передано: ${STATUS_LABEL[next]}`);
    } catch (err) {
      toast.error(`Не удалось передать: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => void advance()}
      title={`Передать задачу в «${STATUS_LABEL[next]}»`}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
    >
      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
      {STATUS_LABEL[next]}
    </button>
  );
}

// Цвета статус-пилюли — в тон колонкам доски (kanbanColors): черновики stone,
// вручную yellow, воркер blue, готово green; активные in_progress/awaiting — свои.
const STATUS_BADGE_COLOR: Record<TaskStatus, string> = {
  backlog: 'bg-stone-500/15 text-stone-600 dark:bg-stone-500/20 dark:text-stone-300',
  manual: 'bg-yellow-500/15 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  todo: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  in_progress: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  awaiting_clarification: 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  done: 'bg-green-500/15 text-green-700 dark:bg-green-500/20 dark:text-green-400',
};

// Chip-селектор статуса задачи в edit-mode шапки. Показывает текущий статус
// цветным бейджем; клик раскрывает dropdown для смены — move идёт сразу (optimistic).
function TaskStatusChip({
  task,
  onMove,
  onChanged,
}: {
  task: Task;
  onMove: (taskId: string, targetStatus: TaskStatus) => Promise<void>;
  onChanged: () => void;
}): React.ReactElement {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(task.status);
  }, [task.status]);

  const change = async (next: TaskStatus): Promise<void> => {
    if (next === status || saving) return;
    const prev = status;
    setStatus(next); // optimistic
    setSaving(true);
    try {
      await onMove(task.id, next);
      onChanged();
    } catch (err) {
      setStatus(prev);
      toast.error(`Не удалось сменить статус: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className={cn(
            // Чистая «таблетка» статуса: мягкая заливка по статусу, без странной hover-окантовки;
            // лёгкое затемнение и press-feedback. Комфортный тап-таргет (py-1, text-xs).
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-[filter,transform] hover:brightness-95 active:scale-[0.97] disabled:opacity-50',
            STATUS_BADGE_COLOR[status],
          )}
        >
          {STATUS_LABEL[status]}
          <ChevronDown className="size-3.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuRadioGroup value={status} onValueChange={(v) => void change(v as TaskStatus)}>
          {TASK_STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s} className="py-1.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  STATUS_BADGE_COLOR[s],
                )}
              >
                {STATUS_LABEL[s]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskDrawer({
  state,
  onClose,
  onSubmit,
  onCommitsChange,
  projectName,
  backlogTail = null,
  todoTail = null,
  isInbox = false,
  isShared = false,
  aiProjectId = null,
  onMove,
  asPage = false,
  breadcrumbs = null,
}: Props): React.ReactElement {
  const { user: currentUser } = useCurrentUser();
  const { taskRepository, recordTaskView, userRepository } = useContainer();
  const navigate = useNavigate();
  // Task 11: порядок строк-свойств — за пользователем (ui_prefs), один на все проекты.
  const [propertyOrder, setPropertyOrder] = useState<TaskPropertyKey[]>(() =>
    normalizeTaskPropertyOrder(undefined),
  );
  useEffect(() => {
    let cancelled = false;
    void userRepository
      .getUiPrefs()
      .then((p) => {
        if (!cancelled) setPropertyOrder(normalizeTaskPropertyOrder(p.taskPropertyOrder));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userRepository]);
  const propSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const handlePropDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPropertyOrder((prev) => {
      const from = prev.indexOf(active.id as TaskPropertyKey);
      const to = prev.indexOf(over.id as TaskPropertyKey);
      if (from < 0 || to < 0) return prev;
      const next = arrayMove(prev, from, to);
      void userRepository.setUiPrefs({ taskPropertyOrder: next }).catch(() => {});
      return next;
    });
  };
  const { animations } = useMotion();
  // Фиксируем «юзер открыл задачу» — единая точка для всех мест, где открывается drawer
  // (доска, «Поручено мне», блок «Недавнее»). Только edit-mode с реальной задачей; раз на
  // taskId. Fire-and-forget (ошибки глотаем), затем шлём 'pf:recent-changed' — блок
  // «Недавнее» в сайдбаре перефетчит без перезагрузки.
  // Поднимаем задачу в «Недавнее» ТОЛЬКО при реальной правке (а не при простом открытии):
  // раньше любой просмотр помечал задачу «только что» и кидал её наверх. Один раз на taskId.
  const recordedTaskIdRef = useRef<string | null>(null);
  const openTaskId = state?.mode === 'edit' ? state.task.id : null;
  const openTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    openTaskIdRef.current = openTaskId;
  }, [openTaskId]);
  const markViewedOnEdit = useCallback(() => {
    const id = openTaskIdRef.current;
    if (!id || recordedTaskIdRef.current === id) return;
    recordedTaskIdRef.current = id;
    void recordTaskView
      .execute(id)
      .then(() => window.dispatchEvent(new CustomEvent('pf:recent-changed')))
      .catch(() => {});
  }, [recordTaskView]);
  // Любая правка (описание/свойства/комменты/файлы) идёт через этот колбэк: фиксируем
  // просмотр (для «Недавнее») и уведомляем родителя обновить бейджи.
  const notifyChanged = useCallback(() => {
    markViewedOnEdit();
    onCommitsChange?.();
  }, [markViewedOnEdit, onCommitsChange]);
  // В create-mode description редактируется одним RichTextEditor на форме; в edit-mode
  // заголовок/тело живут в editDescription + TaskTitleEditor/TaskBodyEditor (см. ниже),
  // а это локальное состояние используется только в create-режиме (submit формы).
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending-файлы при создании задачи. Берём File-объекты + Blob URL для превью,
  // после успешного create аплоадим их пачкой.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  // Режим Ralph для create-mode (в edit-mode значение приходит из state.task).
  const [createRalphMode, setCreateRalphMode] = useState<RalphMode>('normal');
  // Делегат для create-mode (только inbox). Очищаем после закрытия drawer'а.
  const [createDelegateUserId, setCreateDelegateUserId] = useState<string | null>(null);
  // Срок и приоритет для create-mode (применимо к любому проекту).
  const [createDeadline, setCreateDeadline] = useState<string | null>(null);
  const [createPriority, setCreatePriority] = useState<TaskPriority | null>(null);
  // Единый флаг перетаскивания файла из ОС на окно (create И edit). Большой оверлей
  // «Перетащите сюда файл» рендерится на уровне видимой коробки окна (см. DrawerShell),
  // поэтому покрывает ровно то, что юзер видит, при любом размере/скролле.
  const [dragActive, setDragActive] = useState(false);
  // Счётчик dragenter/dragleave (вложенные элементы шлют события) — оверлей гаснет
  // только когда курсор реально покинул окно, а не при наведении на дочерний элемент.
  const dragDepth = useRef(0);
  // Активные аплоады (edit-mode) — прогресс-бары под рядом свойств «Файлы».
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  // Императивные handle'ы редакторов — для «+ Подзадача» (вставить пункт и сфокусироваться).
  const bodyEditorRef = useRef<RichTextEditorHandle>(null);
  const createEditorRef = useRef<RichTextEditorHandle>(null);
  // Ref на скрытый file input для кнопки «Вложение» в create-mode.
  const createFileInputRef = useRef<HTMLInputElement>(null);
  // Контейнер тела create-формы — чтобы Enter в заголовке переводил фокус в тело.
  const createBodyContainerRef = useRef<HTMLDivElement>(null);
  // Ref на скрытый file input для add-affordance «+ Файл» в edit-mode (ряд свойств).
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  // Ref-канал для footer-композера → TaskCommentsSection: после создания комментария
  // композер дёргает текущий handler чтобы вставить созданный коммент в список.
  const onCommentCreatedRef = useRef<((c: TaskComment) => void) | null>(null);
  // Ref на scrollable body — нужен чтобы скроллнуть вниз при открытии (комментарии
  // сверху-вниз, новые внизу — пользователь хочет видеть свежие сразу).
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollBodyToBottom = useCallback((): void => {
    const el = bodyRef.current;
    if (!el) return;
    // requestAnimationFrame даёт layout'у отстояться после mount'а / появления коммитов.
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    });
  }, []);
  // Описание задачи всегда раскрыто — без кнопки раскрытия/сворачивания (по требованию).
  // Активная вкладка тела edit-режима: «Обсуждение» (комментарии) | LIVE (лента воркера).
  // Запоминаем выбор в localStorage — иначе ре-рендер родителя (напр. сворачивание сайдбара)
  // сбрасывал бы на «Обсуждение». Не форсим reset на открытии (см. эффект сброса ниже).
  const [activeTab, setActiveTab] = useState<'discussion' | 'live'>(() => {
    try {
      return localStorage.getItem('pf-task-tab') === 'live' ? 'live' : 'discussion';
    } catch {
      return 'discussion';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('pf-task-tab', activeTab);
    } catch {
      /* localStorage недоступен */
    }
  }, [activeTab]);
  // Есть ли running LIVE-сессия (бейдж 🔴 на триггере вкладки). LiveTab сообщает через колбэк.
  const [liveRunning, setLiveRunning] = useState(false);
  // Кол-во комментариев — свёрнуто в триггер «Обсуждение · N». TaskCommentsSection сообщает.
  const [commentCount, setCommentCount] = useState(0);
  // Cache аттачей для header-row.
  const [headerAttachments, setHeaderAttachments] = useState<TaskAttachment[]>([]);

  // Re-fetch header attachments when active task changes / commits-change tick.
  useEffect(() => {
    if (state?.mode !== 'edit') {
      setHeaderAttachments([]);
      return;
    }
    let cancelled = false;
    void taskRepository
      .listAttachments(state.task.projectId, state.task.id)
      .then((list) => {
        if (!cancelled) setHeaderAttachments(list);
      })
      .catch(() => {
        /* tolerate — header-row не критичен */
      });
    return () => {
      cancelled = true;
    };
  }, [state, taskRepository]);

  const refetchHeaderAttachments = useCallback((): void => {
    if (state?.mode !== 'edit') return;
    const { projectId, id } = state.task;
    void taskRepository.listAttachments(projectId, id).then(setHeaderAttachments).catch(() => undefined);
  }, [state, taskRepository]);

  // === EDIT-MODE: единое описание-источник правды для заголовка + тела ===
  // Доменная модель хранит ОДНО поле `description` (markdown). Notion-style мы режем его
  // на заголовок (1-я строка, plain) и тело (остаток, markdown) через splitTitleBody, а
  // сохраняем склейкой joinTitleBody. Источник правды — здесь (а не внутри редакторов),
  // чтобы смена заголовка не затирала тело и наоборот. Сеется из task.description и
  // пере-сеется при смене задачи (родитель не обновляет task.description у открытого
  // дровера — поэтому держим локально, как делал прежний TaskDescriptionEditor).
  const editTaskId = state?.mode === 'edit' ? state.task.id : null;
  const [editDescription, setEditDescription] = useState('');
  // Идёт ли сохранение описания — state (а не ref), т.к. дизейблит редакторы (render-relevant).
  const [editSaving, setEditSaving] = useState(false);
  useEffect(() => {
    if (state?.mode === 'edit') setEditDescription(state.task.description ?? '');
    else setEditDescription('');
    // Пере-сеем только при смене задачи (id) или режима — правки в открытом дровере
    // не должны сбрасываться родительским refetch'ем (он не меняет task.description здесь).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTaskId, state?.mode]);

  // Единый путь сохранения описания (title+body) → taskRepository.update. Возвращаемое
  // описание становится новым источником правды (на случай нормализации сервером).
  // No-op, если ничего не изменилось.
  const commitDescription = useCallback(
    async (nextDescription: string): Promise<void> => {
      if (state?.mode !== 'edit') return;
      const { projectId, id } = state.task;
      const trimmed = nextDescription.trim();
      // Заголовок (1-я строка) обязателен: пустое описание — не сохраняем (как прежде).
      if (splitTitleBody(trimmed).title.length === 0) return;
      if (trimmed === editDescription.trim()) return;
      setEditSaving(true);
      try {
        const updated = await taskRepository.update(projectId, id, { description: trimmed });
        setEditDescription(updated.description ?? '');
        notifyChanged();
      } catch (e) {
        toast.error(`Не удалось сохранить: ${(e as Error).message}`);
      } finally {
        setEditSaving(false);
      }
    },
    [state, taskRepository, editDescription, notifyChanged],
  );

  // Заголовок и описание — ОДНО поле: правим полное описание напрямую (1-я строка = заголовок).
  const handleDescriptionChange = useCallback((next: string): void => {
    setEditDescription(next);
  }, []);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  // Task 3: при скролле вниз вверху закрепляем укороченный заголовок задачи; клик по нему
  // прокручивает обратно наверх. Sentinel у заголовка + IntersectionObserver: когда заголовок
  // ушёл под шапку — показываем sticky-бар.
  const titleSentinelRef = useRef<HTMLDivElement>(null);
  const [showStickyTitle, setShowStickyTitle] = useState(false);
  useEffect(() => {
    const el = titleSentinelRef.current;
    if (!el || state?.mode !== 'edit') {
      setShowStickyTitle(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setShowStickyTitle(entry ? !entry.isIntersecting : false),
      { rootMargin: '-48px 0px 0px 0px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [state?.mode, openTaskId]);
  const scrollToTaskTop = (): void => {
    titleSentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Unmount-save: дровер закрывают/переключают задачу, не сняв фокус с редактора. blur-save
  // ловит клик мимо поля; этот хук — страховка. latest-ref обновляем в эффекте (включая
  // projectId — в cleanup-замыкании `state` был бы уже null после закрытия).
  const editProjectId = state?.mode === 'edit' ? state.task.projectId : null;
  const editLiveRef = useRef({ description: editDescription, taskId: editTaskId, projectId: editProjectId, saving: editSaving });
  useEffect(() => {
    editLiveRef.current = { description: editDescription, taskId: editTaskId, projectId: editProjectId, saving: editSaving };
  });
  useEffect(
    () => () => {
      const s = editLiveRef.current;
      if (!s.taskId || !s.projectId || s.saving) return;
      const trimmed = s.description.trim();
      if (splitTitleBody(trimmed).title.length === 0) return;
      // Fire-and-forget — компонент уже размонтируется. update идемпотентен по содержимому
      // (server не плодит ревизию при том же description).
      void taskRepository
        .update(s.projectId, s.taskId, { description: trimmed })
        .catch(() => undefined);
    },
    // Зависимость только от taskId — хук-cleanup стреляет при размонтировании/смене задачи.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editTaskId],
  );

  // autoFocus только на desktop — на мобильных клавиатура сразу перекрывает диалог.
  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  // Ref на форму создания — Ctrl/Cmd+Enter внутри редактора сабмитит её программно.
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    setDescription(state.mode === 'edit' ? state.task.description ?? '' : '');
    setCreateRalphMode('normal');
    setCreateDelegateUserId(null);
    setCreateDeadline(null);
    setCreatePriority(null);
    setError(null);
    // activeTab НЕ сбрасываем — он запоминается (localStorage), чтобы ре-рендер
    // родителя (сворачивание сайдбара и т.п.) не выкидывал из LIVE в «Обсуждение».
    setLiveRunning(false);
    setCommentCount(0);
    setDragActive(false);
    dragDepth.current = 0;
    setUploads([]);
    // При закрытии/смене диалога чистим pending — URL.revokeObjectURL для blob'ов.
    setPendingFiles((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, [state]);

  const addPendingFiles = (raw: FileList | File[]): void => {
    const valid = Array.from(raw);
    if (valid.length === 0) return;
    const additions: PendingFile[] = valid.map((file) => ({
      id: crypto.randomUUID(),
      file,
      // Blob URL только для картинок (для thumbnail); иначе превью не нужно.
      previewUrl: isImageFile(file.type, file.name) ? URL.createObjectURL(file) : '',
    }));
    setPendingFiles((prev) => [...prev, ...additions]);
  };

  // Direct upload for edit-mode (paste, drag&drop, «+ Файл»). Каждый файл получает
  // прогресс-бар (uploads); грузим параллельно — несколько баров одновременно.
  const uploadFilesDirectly = async (files: File[]): Promise<void> => {
    if (state?.mode !== 'edit') return;
    const { projectId, id } = state.task;
    const items = files.map((file) => ({ uploadId: crypto.randomUUID(), file }));
    const startedAt = Date.now();
    setUploads((prev) => [
      ...prev,
      ...items.map((it) => ({ id: it.uploadId, name: it.file.name, progress: 0, startedAt, etaSec: null })),
    ]);
    await Promise.all(
      items.map(async ({ uploadId, file }) => {
        try {
          await taskRepository.uploadAttachment(projectId, id, file, (loaded, total) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId
                  ? {
                      ...u,
                      progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
                      etaSec: computeEtaSec(u.startedAt, loaded, total),
                    }
                  : u,
              ),
            );
          });
        } catch (err) {
          toast.error(`Не удалось загрузить ${file.name}: ${(err as Error).message}`);
        } finally {
          setUploads((prev) => prev.filter((u) => u.id !== uploadId));
        }
      }),
    );
    notifyChanged();
    refetchHeaderAttachments();
  };

  // Удаление вложения (edit-mode) — кнопка «×» на чипе файла в ряду свойств.
  const deleteAttachmentDirectly = (att: TaskAttachment): void => {
    if (state?.mode !== 'edit') return;
    const { projectId, id } = state.task;
    void taskRepository
      .deleteAttachment(projectId, id, att.id)
      .then(() => {
        notifyChanged();
        refetchHeaderAttachments();
      })
      .catch((err) =>
        toast.error(`Не удалось удалить ${att.filename}: ${(err as Error).message}`),
      );
  };

  // «+ подзадача» (edit-mode): вставляем пустой checklist-пункт через императивный
  // handle редактора и СРАЗУ ставим в него курсор — пользователь печатает без клика
  // мышью. onChange редактора обновит editDescription; запись — по blur/unmount-save.
  // (Бэкенда для подзадач нет — это markdown-чеклист внутри тела, TaskItem рендерит
  // его интерактивным.)
  const appendSubtask = (): void => {
    if (state?.mode !== 'edit') return;
    bodyEditorRef.current?.appendChecklistItem();
  };

  // Form-level paste handler — ловит Ctrl+V где угодно внутри формы (textarea, секция, пустое место).
  // Если в буфере есть картинки — preventDefault (textarea не вставит binary-кашу) и роутим в нужную секцию.
  // Если картинок нет — просто пускаем дефолтное поведение (текст ↦ в textarea).
  const handleFormPaste = (e: ClipboardEvent<HTMLFormElement>): void => {
    const files = extractClipboardFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    if (state?.mode === 'create') {
      addPendingFiles(files);
    } else if (state?.mode === 'edit') {
      void uploadFilesDirectly(files);
    }
  };

  // Единый drag&drop файла из ОС (create И edit). Вешается на видимую коробку окна
  // (DrawerShell), поэтому drop работает в любой её части, а оверлей покрывает ровно
  // видимую область (не скролл-контент). Реагируем только на файлы (types includes
  // 'Files'), чтобы внутренний drag текста/блоков редактора не триггерил оверлей.
  // dragenter/leave считаем глубину — вложенные элементы шлют свои события, иначе мигает.
  const hasFiles = (e: DragEvent<HTMLElement>): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const handleDragEnter = (e: DragEvent<HTMLElement>): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };
  const handleDragOver = (e: DragEvent<HTMLElement>): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  };
  const handleDragLeave = (): void => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  };
  const handleDrop = (e: DragEvent<HTMLElement>): void => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    if (state?.mode === 'create') addPendingFiles(files);
    else void uploadFilesDirectly(files);
  };
  const dragHandlers = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };
  // Большой оверлей-зона. Рендерится в DrawerShell поверх видимой коробки окна
  // (absolute inset-0), pointer-events-none — чтобы не перехватывать drop/dragleave.
  const dragOverlay = dragActive ? (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-sm',
        animations && 'duration-150 animate-in fade-in-0',
      )}
    >
      <UploadCloud className="size-10 text-primary" />
      <span className="text-sm font-medium text-foreground">Перетащите сюда файл</span>
      <span className="text-xs text-muted-foreground">Файл прикрепится к задаче</span>
    </div>
  ) : null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (description.trim().length === 0) {
      setError('Введите описание');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const task = await onSubmit({
        description: description.trim(),
        ralphMode: state?.mode === 'create' ? createRalphMode : undefined,
        delegateUserId: state?.mode === 'create' ? createDelegateUserId : undefined,
        deadline: state?.mode === 'create' ? createDeadline : undefined,
        priority: state?.mode === 'create' ? createPriority : undefined,
      });
      // Если в create-режиме копились файлы — аплоадим их в новосозданную задачу
      // С ПРОГРЕСС-БАРОМ (тот же uploads-стейт + инлайн-бар в строке «Файлы», что и в edit).
      if (state?.mode === 'create' && pendingFiles.length > 0) {
        const startedAt = Date.now();
        setUploads(
          pendingFiles.map((pf) => ({ id: pf.id, name: pf.file.name, progress: 0, startedAt, etaSec: null })),
        );
        let ok = 0;
        for (const pf of pendingFiles) {
          try {
            await taskRepository.uploadAttachment(task.projectId, task.id, pf.file, (loaded, total) => {
              setUploads((prev) =>
                prev.map((u) =>
                  u.id === pf.id
                    ? {
                        ...u,
                        progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
                        etaSec: computeEtaSec(u.startedAt, loaded, total),
                      }
                    : u,
                ),
              );
            });
            ok += 1;
          } catch (err) {
            toast.error(`Не удалось загрузить ${pf.file.name}: ${(err as Error).message}`);
          } finally {
            setUploads((prev) => prev.filter((u) => u.id !== pf.id));
          }
        }
        if (ok > 0) {
          toast.success(
            ok === pendingFiles.length
              ? 'Картинки прикреплены'
              : `Прикреплено ${ok} из ${pendingFiles.length}`,
          );
          notifyChanged();
        }
      }
      onClose();
    } catch (err) {
      setError((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  // Закрытие шторки — двойная стрелка вправо (как «свернуть» у левой панели): окно
  // «уезжает» обратно за правый край. Стоит слева в шапке, крестика справа больше нет.
  const renderCloseButton = (): React.ReactElement => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="group/x size-8 shrink-0"
      onClick={onClose}
      aria-label="Закрыть"
      title="Закрыть"
    >
      <ChevronsRight className="size-4 transition-transform duration-200 group-hover/x:translate-x-0.5" />
    </Button>
  );

  // Кнопка «развернуть на весь экран» — рядом с кнопкой закрытия. Открывает задачу
  // ОТДЕЛЬНОЙ СТРАНИЦЕЙ (/projects/:id/tasks/:taskId) с хлебными крошками — не виджет.
  // На самой странице (asPage) кнопки нет; в create нет задачи для ссылки.
  const renderMaximizeButton = (): React.ReactElement | null => {
    const pageTask = state?.mode === 'edit' ? state.task : null;
    if (asPage || !pageTask || !isDesktop) return null;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => navigate(`/projects/${pageTask.projectId}/tasks/${pageTask.id}`)}
        aria-label="Развернуть на весь экран"
        title="Развернуть на весь экран"
      >
        <Maximize2 className="size-4" />
      </Button>
    );
  };

  const task = state?.mode === 'edit' ? state.task : null;
  const scrollToCommentId = state?.mode === 'edit' ? state.scrollToCommentId : undefined;
  // Контекст ответа/цитаты: выбран в треде (кнопка «Ответить» / выделение), читается
  // композером-футером (плашка «в ответ …») и уходит в createComment. db/080.
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);
  // Редактируем задачу в ЛЮБОМ статусе, включая done (по требованию: «задача всегда
  // редактируема» — плюсики, свойства, тело и кнопки доступны и для выполненных).
  const canEdit = !!task;

  // === Resizable + split drawer (EDIT-mode, desktop only) ===
  // Coarse pointer / narrow viewport → resize disabled, keep default full-width
  // stacked Sheet (mobile untouched). `md` breakpoint is 768px (Tailwind default).
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isFinePointer = useMediaQuery('(pointer: fine)');
  // Resizable + split — на десктопе (edit И create). НЕ завязываем на state.mode: иначе при
  // закрытии (state→null) инлайн-ширина мгновенно слетала на дефолтные 900px → окно «дёргано»
  // расширялось перед закрытием. Без mode-гейта ширина держится всю анимацию закрытия.
  // В asPage (отдельная страница) ресайз не нужен — фиксированная центрированная колонка.
  const resizeEnabled = !asPage && isDesktop && isFinePointer;
  const { width, dragging, isSplit: isSplitRaw, onHandlePointerDown } =
    useResizableWidth(resizeEnabled, state !== null, () => {
      // Дотянули окно до самого края — открываем задачу отдельной страницей.
      if (state?.mode === 'edit') {
        navigate(`/projects/${state.task.projectId}/tasks/${state.task.id}`);
      }
    });
  // В asPage — всегда одна центрированная колонка (Notion-style страница), без split.
  const isSplit = asPage ? false : isSplitRaw;

  return (
    <DrawerShell
      asPage={asPage}
      breadcrumbs={breadcrumbs}
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      contentClassName={cn(
        'grid h-dvh w-full gap-0 overflow-hidden p-0 sm:max-w-[900px]',
        'grid-rows-[minmax(0,1fr)]',
        dragging && '!transition-none',
      )}
      contentStyle={resizeEnabled ? { width: `${width}px`, maxWidth: '96vw' } : undefined}
      dragHandlers={dragHandlers}
      dragOverlay={dragOverlay}
    >
        {/* Drag-ручка на ЛЕВОМ крае дравера (тонкая вертикальная полоса). Тянем
            влево — шире, вправо — уже. Только desktop (resizeEnabled). */}
        {resizeEnabled && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Изменить ширину панели"
            onPointerDown={onHandlePointerDown}
            className={cn(
              'group/resize absolute inset-y-0 left-0 z-50 w-1.5 -translate-x-1/2 cursor-col-resize touch-none',
              'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors',
              'hover:before:bg-primary/40',
              dragging && 'before:bg-primary/60',
            )}
          />
        )}

        {/* a11y stub for Radix Dialog — только в Sheet-режиме (в asPage Sheet'а нет). */}
        {!asPage && (
          <>
            <SheetTitle className="sr-only">
              {state?.mode === 'edit' ? 'Задача' : 'Новая задача'}
              {projectName ? ` · ${projectName}` : ''}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {state?.mode === 'edit' ? 'Редактирование задачи' : 'Создание новой задачи'}
            </SheetDescription>
          </>
        )}

        {state?.mode === 'edit' && task ? (
          // Внешний контейнер раскладки EDIT-mode (заполняет единственную grid-строку
          // SheetContent). isSplit (широкая ширина) → две колонки: задача слева,
          // обсуждение справа, серый разделитель между; иначе — привычный стек
          // (шапка сверху, ниже центрированный переключатель + комменты + композер).
          <div
            className={cn(
              'relative min-h-0',
              // split — две колонки в ряд, у каждой свой скролл; narrow — ОДИН общий
              // скролл всего окна (скроллится этот контейнер, внутренние блоки —
              // натуральной высоты, без своих overflow). Так задача+комменты+композер
              // прокручиваются единой лентой (по просьбе: без разделения на блоки).
              // Drag&drop файла обрабатывается на уровне видимой коробки окна (DrawerShell).
              isSplit
                ? 'flex h-full overflow-hidden'
                : 'flex h-full flex-col overflow-y-auto overscroll-contain',
            )}
          >
            {/* === HEADER / ЛЕВАЯ КОЛОНКА === Notion-style. В стеке — sticky-шапка с
                нижним бордером (единственный разделитель до переключателя вкладок).
                В split — самостоятельная скроллящаяся левая колонка (бордера снизу нет,
                разделитель — вертикальная линия справа от колонки). */}
            <div
              className={cn(
                // БЕЗ backdrop-blur: backdrop-filter создаёт stacking-context и делает
                // колонку containing-block'ом для position:fixed — тогда плавающее меню
                // форматирования зажимается overflow-колонки и уезжает ЗА правую панель
                // комментов в split. Непрозрачный bg-background/95 это не ломает.
                'bg-background/95',
                // split — своя скроллящаяся колонка; narrow — натуральная высота
                // (скроллит общий контейнер выше), внизу разделитель-бордер.
                isSplit
                  ? 'min-w-0 flex-1 overflow-y-auto overscroll-contain'
                  : 'shrink-0 border-b',
              )}
            >
              {/* Task 3: закреплённый укороченный заголовок при скролле. Клик — наверх. */}
              {showStickyTitle && (
                <button
                  type="button"
                  onClick={scrollToTaskTop}
                  title="К началу задачи"
                  className={cn(
                    'sticky top-0 z-20 block w-full border-b bg-background/95 px-4 py-2 text-left backdrop-blur-sm',
                    'cursor-pointer transition-colors hover:bg-hover',
                    animations && 'duration-150 animate-in fade-in-0 slide-in-from-top-1',
                  )}
                >
                  <span className="line-clamp-3 text-sm font-medium leading-snug text-foreground">
                    {stripInlineMarkdown(parseTitleHeading(splitTitleBody(editDescription).title).text) ||
                      'Без названия'}
                  </span>
                </button>
              )}
              {/* Row A: контекст · короткий id (слева), статус (справа). Высота/вертикальное
                  выравнивание как у строки хлебных крошек страницы (min-h-11, по центру) —
                  чтобы кнопки закрыть/развернуть стояли на одной линии с крошками. */}
              <div className="flex min-h-11 items-center gap-2 px-4 pt-2">
                {renderCloseButton()}
                {renderMaximizeButton()}
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  {projectName && (
                    <span className="truncate text-xs font-medium text-muted-foreground">
                      {projectName}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground/50">
                    {taskShortId(task.id)}
                  </span>
                </div>
                {/* Кнопки Копировать/Переработка/План переехали в ряд плюсиков под
                    заголовком (по правому краю) — см. ниже. */}
                {onMove && (
                  <TaskAdvanceButton
                    task={task}
                    onMove={onMove}
                    onChanged={() => notifyChanged()}
                  />
                )}
                {onMove ? (
                  <TaskStatusChip
                    task={task}
                    onMove={onMove}
                    onChanged={() => notifyChanged()}
                  />
                ) : (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      STATUS_BADGE_COLOR[task.status],
                    )}
                  >
                    {STATUS_LABEL[task.status]}
                  </span>
                )}
              </div>

              {/* === ОПИСАНИЕ === Заголовок и описание ОДНИМ полем сверху (1-я строка —
                  по сути заголовок). Полное editDescription редактируется напрямую,
                  сохраняется по blur / Ctrl+Cmd+Enter. Работает в любом статусе. */}
              {/* Sentinel у заголовка — когда уходит под шапку, показываем sticky-заголовок. */}
              <div ref={titleSentinelRef} aria-hidden className="h-0" />
              <div ref={bodyContainerRef} className="px-4 pb-1 pt-1.5">
                <TaskBodyEditor
                  key={`desc-${task.id}`}
                  editorRef={bodyEditorRef}
                  body={editDescription}
                  onBodyChange={handleDescriptionChange}
                  onCommit={() => void commitDescription(editDescription)}
                  onPasteFiles={(files) => void uploadFilesDirectly(files)}
                  disabled={editSaving}
                  placeholder="Название и описание…"
                />
              </div>

              {/* === ПЛЮСИКИ === Горизонтальный ряд add-кнопок (Notion «+Add»-style) прямо
                  под заголовком/описанием и НАД блоком свойств. Только поддерживаемые
                  действия: «+ Подзадача» (дописывает `- [ ]` в описание) и «+ Файл»
                  (открывает скрытый file-picker → uploadFilesDirectly). Переносятся
                  на узких экранах (flex-wrap, вплоть до 320px). */}
              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pb-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      onClick={() => appendSubtask()}
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Plus className="size-4 shrink-0" />
                      Подзадача
                    </button>
                    <button
                      type="button"
                      onClick={() => attachFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Plus className="size-4 shrink-0" />
                      Файл
                    </button>
                    <input
                      ref={attachFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) void uploadFilesDirectly(Array.from(e.target.files));
                        e.target.value = '';
                      }}
                    />
                  </div>
                  {/* Действия по правому краю ряда плюсиков: Копировать / Переработка / План
                      (раньше были в шапке Row A). */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <CopyTaskButton description={editDescription || (task.description ?? '')} />
                    {/* AI переехала сюда (из плавающей таблетки над телом) — компактная,
                        в один ряд с Копировать/Переработать/План. */}
                    <AiComposeDialog
                      text={editDescription}
                      projectId={task.projectId}
                      editTask={{ projectId: task.projectId, taskId: task.id }}
                      onImproved={(next) => {
                        setEditDescription(next);
                        void commitDescription(next);
                      }}
                      onDistributed={() => notifyChanged()}
                      disabled={editSaving}
                      compact
                    />
                    <ReworkTaskButton projectId={task.projectId} taskId={task.id} />
                    <PlanTaskButton projectId={task.projectId} taskId={task.id} />
                  </div>
                </div>
              )}

              {/* === PROPERTIES === Notion-style вертикальные строки свойств. Рендерятся
                  ВСЕГДА (для любого статуса, включая done) — строка не прячется по статусу;
                  если контрол неправим для done — показываем значение, контрол disabled. */}
              {/* Task 11: строки свойств можно перетаскивать (ручка-grip на hover), порядок
                  сохраняется в профиль (ui_prefs) для всех проектов. Значения и видимость
                  собираем в map по ключу, рендерим в сохранённом порядке. */}
              <div className="px-3 pb-2.5 pt-1">
                {(() => {
                  const propValues: Record<TaskPropertyKey, React.ReactNode> = {
                    assignee: (
                      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
                        {task.delegation && currentUser?.id && (
                          <DelegationBadge delegation={task.delegation} currentUserId={currentUser.id} />
                        )}
                        {canEdit && (isInbox || isShared) ? (
                          <DelegateTaskButton
                            task={task}
                            currentUserId={currentUser?.id ?? null}
                            onChanged={() => notifyChanged()}
                            projectId={isShared ? task.projectId : undefined}
                            className={PROPERTY_VALUE_CLASS}
                          />
                        ) : null}
                        {!task.delegation && !(canEdit && (isInbox || isShared)) && (
                          <EmptyValue>Никто</EmptyValue>
                        )}
                        {isInbox && canEdit && (
                          <AssignToProjectSelect
                            task={task}
                            onAssigned={() => {
                              notifyChanged();
                              onClose();
                            }}
                          />
                        )}
                      </div>
                    ),
                    deadline: (
                      <TaskDeadlineChip
                        task={task}
                        onChanged={() => notifyChanged()}
                        className={PROPERTY_VALUE_CLASS}
                        emptyLabel="Пусто"
                        disabled={!canEdit}
                      />
                    ),
                    priority: (
                      <TaskPriorityChip
                        task={task}
                        onChanged={() => notifyChanged()}
                        className={PROPERTY_VALUE_CLASS}
                        disabled={!canEdit}
                      />
                    ),
                    mode: (
                      <TaskRalphModeChip
                        task={task}
                        onChanged={() => notifyChanged()}
                        className={PROPERTY_VALUE_CLASS}
                        disabled={!canEdit}
                      />
                    ),
                    files: (
                      <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-1.5">
                        <TaskDrawerAttachmentRow
                          items={headerAttachments}
                          canEdit={canEdit}
                          onAddFiles={(files) => {
                            void uploadFilesDirectly(files);
                          }}
                          onDelete={deleteAttachmentDirectly}
                          uploads={uploads}
                        />
                      </div>
                    ),
                    created: (
                      <span className="inline-flex min-h-7 items-center text-sm text-muted-foreground/70">
                        {formatTaskCreated(task.createdAt)}
                      </span>
                    ),
                  };
                  const propVisible: Record<TaskPropertyKey, boolean> = {
                    // Ответственный — только когда есть кого назначить (см. task 6a).
                    assignee: isInbox || isShared || !!task.delegation,
                    deadline: true,
                    priority: true,
                    mode: true,
                    files: true,
                    created: true,
                  };
                  const visibleKeys = propertyOrder.filter((k) => propVisible[k]);
                  return (
                    <DndContext
                      sensors={propSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handlePropDragEnd}
                    >
                      <SortableContext items={visibleKeys} strategy={verticalListSortingStrategy}>
                        {visibleKeys.map((key) => (
                          <SortablePropertyRow key={key} id={key} icon={PROP_ICON[key]} label={PROP_LABEL[key]}>
                            {propValues[key]}
                          </SortablePropertyRow>
                        ))}
                      </SortableContext>
                    </DndContext>
                  );
                })()}
              </div>
            </div>

            {/* === РАЗДЕЛИТЕЛЬ (split) === Вертикальная серая линия между колонками. */}
            {isSplit && <div aria-hidden className="w-px shrink-0 bg-border" />}

            {/* === ОБСУЖДЕНИЕ === Переключатель Обсуждение/LIVE + лента + композер.
                Рендерится ОДНИМ блоком (Tabs смонтирован единожды, forceMount у обеих
                вкладок — бейдж 🔴 живёт в фоне). В стеке — нижняя grid-строка (1fr);
                в split — правая колонка фикс-доли с собственным скроллом и футером. */}
            <div
              className={cn(
                'flex flex-col',
                // split — отдельная колонка со своим скроллом; narrow — натуральная
                // высота внутри общего скролла окна.
                isSplit ? 'min-h-0 w-[44%] shrink-0 overflow-hidden' : 'shrink-0',
              )}
            >
              {/* === SCROLLABLE BODY — вкладки Обсуждение | LIVE === */}
              {/* Tabs тянется flex-1; каждая вкладка — свой scroll-контейнер. forceMount
                  на обеих вкладках, чтобы LiveTab жил в фоне (бейдж 🔴 / live-стрим
                  работают даже когда открыта «Обсуждение»). Неактивная скрыта через hidden. */}
              <Tabs
                value={activeTab}
                onValueChange={(v: string) => setActiveTab(v as 'discussion' | 'live')}
                className={cn(
                  'min-w-0',
                  // split — grid с фикс-высотой под собственный скролл вкладки; narrow —
                  // натуральный flex (высоту даёт контент, скроллит общий контейнер).
                  isSplit
                    ? 'grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden'
                    : 'flex flex-col',
                )}
              >
              {/* Центрированный переключатель Обсуждение | LIVE. Без собственного border —
                  единственный разделитель идёт по нижнему краю шапки выше. Счётчик
                  комментариев свёрнут в триггер «Обсуждение · N». */}
              <div className="flex justify-center px-4 py-2.5">
                <TabsList className="h-8 gap-0.5 rounded-full bg-muted/70 p-0.5">
                  <TabsTrigger
                    value="discussion"
                    className="rounded-full px-4 text-xs font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    Обсуждение
                    {commentCount > 0 && (
                      <span className="ml-1 tabular-nums opacity-60">· {commentCount}</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="live"
                    className="gap-1.5 rounded-full px-4 text-xs font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    LIVE
                    {liveRunning && (
                      <span
                        aria-hidden
                        className="size-1.5 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]"
                      />
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Обсуждение — существующее тело. bodyRef + scrollBodyToBottom живут ТОЛЬКО здесь. */}
              <TabsContent
                value="discussion"
                forceMount
                className={cn('data-[state=inactive]:hidden', isSplit && 'min-h-0 overflow-hidden')}
              >
                {/* Описание закреплено в шапке, коммиты скрыты — тело целиком отдано
                    обсуждению (Notion-style: комментарии и есть страница). В split — свой
                    скролл; в narrow — натуральная высота (скроллит общий контейнер). */}
                <div ref={bodyRef} className={cn('px-4 py-5', isSplit && 'h-full overflow-y-auto')}>
                  <TaskCommentsSection
                    projectId={task.projectId}
                    taskId={task.id}
                    onCommentCreatedRef={onCommentCreatedRef}
                    onFirstLoad={scrollBodyToBottom}
                    onCountChange={setCommentCount}
                    scrollToCommentId={scrollToCommentId}
                    onReply={(commentId, authorName, quotedText) =>
                      setReplyDraft({ commentId, authorName, quotedText })
                    }
                  />
                </div>
              </TabsContent>

              {/* LIVE — лента воркера. Свой scroll-контейнер внутри LiveTab. forceMount —
                  чтобы live-стрим/бейдж работали даже на скрытой вкладке. */}
              <TabsContent
                value="live"
                forceMount
                className={cn(
                  'flex flex-col data-[state=inactive]:hidden',
                  isSplit && 'min-h-0 overflow-hidden',
                )}
              >
                <LiveTab
                  task={task}
                  active={activeTab === 'live'}
                  backlogTail={backlogTail}
                  todoTail={todoTail}
                  onRunningChange={setLiveRunning}
                  onCommentCreated={(c) => {
                    onCommentCreatedRef.current?.(c);
                    notifyChanged();
                  }}
                  onTaskChanged={() => notifyChanged()}
                />
              </TabsContent>
              </Tabs>

              {/* === STICKY FOOTER — композер только на вкладке «Обсуждение» === */}
              {/* Сидит в самом низу колонки обсуждения (shrink-0 авто-высота). */}
              {activeTab === 'discussion' &&
                (task.status === 'in_progress' ? (
                  <CancelWorkButton task={task} onChanged={() => notifyChanged()} />
                ) : (
                  // Один ребёнок: иначе на awaiting_clarification фрагмент из двух
                  // элементов создаёт лишний неявный flex-ребёнок и ломает раскладку.
                  // В narrow (общий скролл) композер липнет к низу окна, чтобы оставаться
                  // под рукой; в split — обычный футер колонки.
                  <div className={cn('shrink-0', !isSplit && 'sticky bottom-0 z-10 bg-background')}>
                    {/* На awaiting_clarification — композер для ralph-answer'а + cancel над ним. */}
                    {task.status === 'awaiting_clarification' && (
                      <CancelWorkButton task={task} onChanged={() => notifyChanged()} />
                    )}
                    <TaskDrawerComposer
                      task={task}
                      backlogTail={backlogTail}
                      todoTail={todoTail}
                      replyDraft={replyDraft}
                      onClearReply={() => setReplyDraft(null)}
                      onNavigateToComment={flashComment}
                      onCommentCreated={(c) => {
                        onCommentCreatedRef.current?.(c);
                        scrollBodyToBottom();
                        notifyChanged();
                      }}
                      onTaskChanged={() => notifyChanged()}
                    />
                  </div>
                ))}
            </div>
          </div>
        ) : (
          // === CREATE MODE === — окно создания = окно редактирования: заголовок +
          // плюсики + ряд свойств + тело, resizable + split (справа — плейсхолдер
          // пустых комментариев). Источник правды — единое `description`.
          <div
            className={cn('min-h-0 overflow-hidden', isSplit ? 'flex h-full' : 'flex h-full flex-col')}
          >
            {/* ЛЕВАЯ КОЛОНКА: скроллящаяся форма + футер (Отмена/Создать). */}
            <div
              className={cn(
                // БЕЗ backdrop-blur — см. коммент у edit-колонки (иначе плавающее меню
                // форматирования зажимается stacking-context'ом колонки в split).
                'flex min-h-0 flex-col bg-background/95',
                isSplit ? 'min-w-0 flex-1' : 'min-h-0 flex-[1.3] border-b',
              )}
            >
              <form
                ref={formRef}
                id="task-drawer-form"
                onSubmit={handleSubmit}
                onPaste={handleFormPaste}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                {/* Row A: close + контекст. Высота/выравнивание как у строки крошек (min-h-11). */}
                <div className="flex min-h-11 items-center gap-2 px-4 pt-2">
                  {renderCloseButton()}
                  {renderMaximizeButton()}
                  <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {projectName ? `${projectName} · ` : ''}Новая задача
                  </span>
                </div>

                {/* Заголовок и описание — ОДНИМ полем сверху (1-я строка = заголовок). */}
                <div ref={createBodyContainerRef} className="px-4 pb-1 pt-1.5">
                  <Suspense fallback={<div className="min-h-[6rem]" />}>
                    <RichTextEditor
                      ref={createEditorRef}
                      variant="description"
                      value={description}
                      onChange={setDescription}
                      onSubmit={() => {
                        if (description.trim().length === 0) {
                          setError('Введите описание');
                          return;
                        }
                        formRef.current?.requestSubmit();
                      }}
                      placeholder="Название и описание…"
                      autoFocus={!isCoarsePointer}
                      onPasteFiles={addPendingFiles}
                      className="min-h-[6rem] text-sm leading-snug"
                    />
                  </Suspense>
                </div>

                {/* Плюсики: + Подзадача / + Файл. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-0.5">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => createEditorRef.current?.appendChecklistItem()}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <Plus className="size-4 shrink-0" />
                    Подзадача
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => createFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <Plus className="size-4 shrink-0" />
                    Файл
                  </button>
                  <input
                    ref={createFileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addPendingFiles(Array.from(e.target.files));
                      e.target.value = '';
                    }}
                  />
                </div>

                {/* Ряд свойств (как в edit): Ответственный / Дедлайн / Приоритет / Режим /
                    Файлы. Без «Создано» и статуса — их нет до создания. */}
                <div className="px-3 pb-2.5 pt-1">
                  {/* Ответственный — только когда есть кого назначить (inbox/совместный). */}
                  {(isInbox || isShared) && (
                    <PropertyRow icon={UserPlus} label="Ответственный">
                      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
                        <DelegateSelect
                          value={createDelegateUserId}
                          onChange={setCreateDelegateUserId}
                          disabled={saving}
                          projectId={isShared && aiProjectId ? aiProjectId : undefined}
                          className={PROPERTY_VALUE_CLASS}
                        />
                      </div>
                    </PropertyRow>
                  )}

                  <PropertyRow icon={CalendarClock} label="Дедлайн">
                    <DeadlinePicker
                      value={createDeadline}
                      onChange={setCreateDeadline}
                      disabled={saving}
                      className={PROPERTY_VALUE_CLASS}
                    />
                  </PropertyRow>

                  <PropertyRow icon={Flag} label="Приоритет">
                    <PrioritySelect
                      value={createPriority}
                      onChange={setCreatePriority}
                      disabled={saving}
                      className={PROPERTY_VALUE_CLASS}
                    />
                  </PropertyRow>

                  <PropertyRow icon={Bot} label="Режим">
                    <RalphModeSelect
                      value={createRalphMode}
                      onChange={setCreateRalphMode}
                      disabled={saving}
                      variant="ghost"
                      className={PROPERTY_VALUE_CLASS}
                    />
                  </PropertyRow>

                  {/* Та же строка файлов, что и в edit: чипы + «+» в строке + прогресс-бары. */}
                  <PropertyRow icon={Paperclip} label="Файлы">
                    <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-1.5">
                      <TaskDrawerAttachmentRow
                        items={[]}
                        canEdit={!saving}
                        onAddFiles={(files) => addPendingFiles(files)}
                        pending={pendingFiles.map((pf) => ({
                          id: pf.id,
                          name: pf.file.name,
                          previewUrl: pf.previewUrl,
                        }))}
                        onRemovePending={(id) =>
                          setPendingFiles((prev) => {
                            const target = prev.find((p) => p.id === id);
                            if (target) URL.revokeObjectURL(target.previewUrl);
                            return prev.filter((p) => p.id !== id);
                          })
                        }
                        uploads={uploads}
                      />
                    </div>
                  </PropertyRow>
                </div>

                {error && <p className="px-4 pb-2 text-xs text-destructive">{error}</p>}
              </form>

              {/* Футер: AI слева, Отмена/Создать справа. */}
              <div className="flex flex-col gap-2 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AiImproveButton
                    text={description}
                    projectId={aiProjectId}
                    onImproved={setDescription}
                    disabled={saving}
                    compact
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onClose}>
                    Отмена
                  </Button>
                  <Button type="submit" form="task-drawer-form" size="sm" className="h-8" disabled={saving}>
                    {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                    Создать
                  </Button>
                </div>
              </div>
            </div>

            {/* ПРАВАЯ КОЛОНКА (split): плейсхолдер — комментарии появятся после создания. */}
            {isSplit && <div aria-hidden className="w-px shrink-0 bg-border" />}
            {isSplit && (
              <div className="w-[44%] shrink-0 overflow-y-auto">
                <CommentsEmptyState
                  className="min-h-full"
                  label="Комментарии появятся после создания"
                  hint="Сначала создайте задачу — обсуждение откроется здесь."
                />
              </div>
            )}
          </div>
        )}
    </DrawerShell>
  );
}

// =========================================================
// Comments — список + inline-edit + удаление + бокс «новый комментарий». Старые сверху,
// новые снизу (chat-style). Каждое сообщение — клик по тексту → textarea для редактирования.
// =========================================================

function TaskCommentsSection({
  projectId,
  taskId,
  // External composer (footer of TaskDrawer). When provided, the section
  // skips the inline `CommentComposer` and exposes `handleCreated` via this
  // ref so the parent's composer can push newly created comments into the list.
  onCommentCreatedRef,
  // Дёргается один раз после первой успешной загрузки комментариев — drawer
  // использует это, чтобы скроллнуть body вниз (к последнему сообщению).
  onFirstLoad,
  // Сообщает текущее число комментариев — drawer сворачивает его в триггер «Обсуждение · N».
  onCountChange,
  // Deep-link: id комментария, к которому надо скроллнуть после загрузки (?task=X#comment-Y).
  scrollToCommentId,
  // Ответ/цитата: тред просит композер ответить на коммент (с опц. выделенным фрагментом).
  onReply,
}: {
  projectId: string;
  taskId: string;
  onCommentCreatedRef?: React.MutableRefObject<((c: TaskComment) => void) | null>;
  onFirstLoad?: () => void;
  onCountChange?: (count: number) => void;
  scrollToCommentId?: string;
  onReply?: (commentId: string, authorName: string, quotedText: string | null) => void;
}): React.ReactElement {
  const { taskRepository, projectRepository } = useContainer();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  // members используются для @-mention пикера. Грузим вместе с комментариями.
  // Ошибка load'а members не блокирует комментарии (degrade gracefully — без пикера).
  const [members, setMembers] = useState<ProjectMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    taskRepository
      .listComments(projectId, taskId)
      .then((list) => {
        if (!cancelled) {
          setComments(list);
          onFirstLoad?.();
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Не удалось загрузить комментарии: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    projectRepository
      .listMembers(projectId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        /* tolerate — без members просто не показываем пикер */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, taskRepository, projectRepository, onFirstLoad]);

  // Deep-link из письма/TG: ?task=X#comment-Y → скроллим к комментарию и подсвечиваем.
  // id приходит пропом (KanbanBoard ловит его из hash до того как очистит ?task=).
  useEffect(() => {
    if (loading || !scrollToCommentId) return undefined;
    if (!comments.some((c) => c.id === scrollToCommentId)) return undefined;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`comment-${scrollToCommentId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('pf-comment-flash');
      window.setTimeout(() => el.classList.remove('pf-comment-flash'), 2000);
    }, 60);
    return () => window.clearTimeout(t);
  }, [loading, comments, scrollToCommentId]);

  const handleUpdated = (updated: TaskComment): void => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleDeleted = (id: string): void => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const handleCreated = (created: TaskComment): void => {
    setComments((prev) => [...prev, created]);
  };

  // Expose for external composer (footer of TaskDrawer).
  useEffect(() => {
    if (onCommentCreatedRef) {
      onCommentCreatedRef.current = handleCreated;
      return () => {
        onCommentCreatedRef.current = null;
      };
    }
    return undefined;
  }, [onCommentCreatedRef]);

  // qid'ы, на которые уже есть ответ — чтобы прятать кнопки у отвеченных вопросов.
  const answeredQids = answeredQidSet(comments);

  // Сообщаем drawer'у число комментариев (после загрузки) — для триггера «Обсуждение · N».
  useEffect(() => {
    if (!loading) onCountChange?.(comments.length);
  }, [loading, comments.length, onCountChange]);

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-md bg-muted" />
          <div className="h-12 animate-pulse rounded-md bg-muted" />
        </div>
      ) : comments.length > 0 ? (
        <ul className="space-y-4">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              projectId={projectId}
              taskId={taskId}
              comment={c}
              members={members}
              answeredQids={answeredQids}
              onAnswerCreated={handleCreated}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
              onReply={onReply}
              replyParent={
                c.replyToCommentId ? (comments.find((x) => x.id === c.replyToCommentId) ?? null) : null
              }
              onNavigateToComment={flashComment}
            />
          ))}
        </ul>
      ) : (
        // Мобайл — компактнее (иначе огромная пустота над композером); десктоп — выше/по центру.
        <CommentsEmptyState className="min-h-[180px] py-6 sm:min-h-[40vh] sm:py-10" />
      )}

      {!onCommentCreatedRef && (
        <CommentComposer
          projectId={projectId}
          taskId={taskId}
          members={members}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

// =========================================================
// New-comment composer. WYSIWYG-редактор (RichTextEditor) с встроенными @-упоминаниями
// (mention сериализуется в literal `@DisplayName` — server потом распарсит и зарегает
// notification'ы). Enter — отправка, Shift+Enter — перенос строки. Превью использует
// CommentBody (read-view идентичен сохранённому markdown).
// =========================================================

function CommentComposer({
  projectId,
  taskId,
  members,
  onCreated,
}: {
  projectId: string;
  taskId: string;
  members: readonly ProjectMember[];
  onCreated: (created: TaskComment) => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const { user: currentUser } = useCurrentUser();
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState(false);
  // Адресация уведомления (по умолчанию — все участники).
  const [notify, setNotify] = useState<NotifyAudience>({ mode: 'all' });
  const [pending, setPending] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Кандидаты в @-упоминания — все участники кроме автора.
  const mentionMembers = toMentionMembers(members.filter((m) => m.userId !== currentUser?.id));

  const addFiles = (raw: FileList | File[]): void => {
    const list = Array.from(raw);
    if (list.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...list.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: isImageFile(file.type, file.name) ? URL.createObjectURL(file) : '',
      })),
    ]);
  };
  const removeFile = (id: string): void => {
    setPending((prev) => {
      prev.filter((p) => p.id === id).forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      return prev.filter((p) => p.id !== id);
    });
  };

  const submit = async (): Promise<void> => {
    const trimmed = body.trim();
    // Разрешаем отправку, если есть текст ИЛИ вложения.
    if ((trimmed.length === 0 && pending.length === 0) || submitting) return;
    setSubmitting(true);
    try {
      const created = await taskRepository.createComment(projectId, taskId, trimmed || ' ', notify);
      const uploaded: TaskAttachment[] = [];
      for (const pf of pending) {
        try {
          uploaded.push(
            await taskRepository.uploadCommentAttachment(projectId, taskId, created.id, pf.file),
          );
        } catch (err) {
          toast.error(`Не удалось загрузить ${pf.file.name}: ${(err as Error).message}`);
        }
      }
      onCreated({ ...created, attachments: uploaded });
      setBody('');
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      setPending([]);
    } catch (e) {
      toast.error(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative rounded-md border bg-card transition-colors focus-within:border-foreground/30">
      {preview ? (
        <div className="min-h-[2.75rem] px-3 py-2">
          {body.trim().length > 0 ? (
            <CommentBody body={body} />
          ) : (
            <p className="text-sm text-muted-foreground/70">Нечего показывать</p>
          )}
        </div>
      ) : (
        <Suspense fallback={<div className="min-h-[2.75rem] px-3 py-2 text-sm">{body}</div>}>
          <RichTextEditor
            variant="comment"
            value={body}
            onChange={setBody}
            onSubmit={() => void submit()}
            members={mentionMembers}
            onPasteFiles={addFiles}
            disabled={submitting}
            placeholder="Комментарий…"
            className="min-h-[2.75rem] px-3 py-2 text-sm"
          />
        </Suspense>
      )}
      <div className="absolute right-1.5 top-1.5 flex gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="group/at size-8"
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting}
          aria-label="Прикрепить файл"
        >
          <Paperclip className="size-4 transition-transform duration-150 group-hover/at:-rotate-12 group-hover/at:scale-110" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="group/send size-8 text-primary hover:text-primary disabled:text-muted-foreground"
          onClick={() => void submit()}
          disabled={submitting || (body.trim().length === 0 && pending.length === 0)}
          aria-label="Отправить"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4 transition-transform duration-150 group-hover/send:-translate-y-0.5 group-hover/send:translate-x-0.5 group-active/send:scale-90" />
          )}
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
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
          {pending.map((pf) => (
            <span
              key={pf.id}
              className="inline-flex items-center gap-1 rounded border bg-muted/60 py-0.5 pl-1.5 pr-1 text-[11px]"
            >
              {pf.previewUrl ? (
                <img src={pf.previewUrl} alt="" className="size-4 rounded object-cover" />
              ) : (
                <FileText className="size-3.5 text-muted-foreground" />
              )}
              <span className="max-w-[120px] truncate">{pf.file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(pf.id)}
                className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive hover:text-white"
                aria-label="Убрать"
              >
                <Trash2 className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 px-3 pb-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => setPreview(false)}
          className={cn('transition-colors', preview ? 'text-muted-foreground hover:text-foreground' : 'font-medium text-foreground')}
        >
          Написать
        </button>
        <button
          type="button"
          onClick={() => setPreview(true)}
          className={cn('transition-colors', preview ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          Превью
        </button>
        <div className="ml-auto">
          <NotifyAudienceControl
            projectId={projectId}
            excludeUserId={currentUser?.id ?? null}
            members={members}
            value={notify}
            onChange={setNotify}
            disabled={submitting}
          />
        </div>
      </div>
    </div>
  );
}

const COMMENT_TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatCommentTime(date: Date): string {
  return COMMENT_TIME_FORMATTER.format(date);
}

// Маппинг agent_name → читаемые имя + модель (рендерятся раздельно: имя — акцентом,
// модель — приглушённо, как в Notion). Default — диспетчер (исторически 99% автокомментов).
// Расширяется без deploy backend'а — новые worker'ы добавлять сюда.
function agentMeta(agentName: string | null): { name: string; sub: string } {
  switch (agentName) {
    case 'ralph-worker':
      return { name: 'Воркер', sub: 'Claude Opus 4.7' };
    case 'ralph-grillme':
      return { name: 'Grillme-агент', sub: 'Claude Opus 4.7' };
    case 'ralph-verify':
      return { name: 'Верификатор', sub: 'Claude Sonnet 4.6' };
    case 'ralph-dispatcher':
    case null:
      return { name: 'Диспетчер', sub: 'Claude Code/Opus' };
    default:
      // Forward-compat: незнакомое имя — generic с показом raw-имени.
      return { name: 'Агент', sub: agentName };
  }
}

function CommentItem({
  projectId,
  taskId,
  comment,
  members,
  answeredQids,
  onAnswerCreated,
  onUpdated,
  onDeleted,
  onReply,
  replyParent,
  onNavigateToComment,
}: {
  projectId: string;
  taskId: string;
  comment: TaskComment;
  // Участники проекта — для резолва автора комментария по ownerUserId (имя + аватар).
  members: readonly ProjectMember[];
  answeredQids: Set<string>;
  onAnswerCreated: (created: TaskComment) => void;
  onUpdated: (updated: TaskComment) => void;
  onDeleted: (id: string) => void;
  // Ответ/цитата (db/080).
  onReply?: (commentId: string, authorName: string, quotedText: string | null) => void;
  replyParent?: TaskComment | null;
  onNavigateToComment?: (commentId: string, quotedText?: string | null) => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Вопрос Ralph (F11) в этом комментарии → инлайн-кнопки ответа (как в CLI/Telegram).
  const ralphQuestion = parseRalphQuestion(comment.body);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  const enterEdit = (): void => {
    setDraft(comment.body);
    setEditing(true);
  };
  const cancel = (): void => {
    setDraft(comment.body);
    setEditing(false);
  };

  const save = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      toast.error('Комментарий не может быть пустым');
      return;
    }
    if (trimmed === comment.body.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await taskRepository.updateComment(projectId, taskId, comment.id, trimmed);
      // Сервер на update возвращает комментарий без вложений — сохраняем текущие.
      onUpdated({ ...updated, attachments: comment.attachments });
      setEditing(false);
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm('Удалить комментарий?')) return;
    try {
      await taskRepository.deleteComment(projectId, taskId, comment.id);
      onDeleted(comment.id);
    } catch (e) {
      toast.error(`Не удалось удалить: ${(e as Error).message}`);
    }
  };

  // Esc внутри редактора → отмена правки (capture на обёртке, редактор Esc не отдаёт).
  const handleWrapperKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };
  // Кандидаты в @-упоминания — все участники кроме автора этого комментария.
  const mentionMembers = toMentionMembers(members.filter((m) => m.userId !== comment.ownerUserId));

  const isEdited = comment.updatedAt.getTime() - comment.createdAt.getTime() > 1500;
  // Автор резолвится по ownerUserId через участников проекта (в совместных проектах
  // комментарии пишут разные люди). Фолбэк — текущий юзер (свой коммент в inbox,
  // где members может не успеть загрузиться) или «—» для вышедших из проекта.
  const { user } = useCurrentUser();
  const isAgent = comment.actorKind === 'agent';
  const isSystem = comment.actorKind === 'system';
  const author = members.find((m) => m.userId === comment.ownerUserId)?.user ?? null;
  const displayName =
    author?.displayName ??
    (user && comment.ownerUserId === user.id ? user.displayName : '—');
  const avatarUrl =
    author?.avatarUrl ?? (user && comment.ownerUserId === user.id ? user.avatarUrl : null);
  const initials = getInitials(displayName);

  // Имя автора родительского коммента — для баннера «в ответ …» (db/080).
  const replyParentName = replyParent
    ? (members.find((m) => m.userId === replyParent.ownerUserId)?.user.displayName ??
      (user && replyParent.ownerUserId === user.id ? user.displayName : '—'))
    : null;
  // Клик «Ответить»: если внутри тела ЭТОГО коммента есть выделение — берём его как цитату.
  const handleReplyClick = (): void => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    const within = !!(
      sel &&
      sel.anchorNode &&
      bodyRef.current &&
      bodyRef.current.contains(sel.anchorNode)
    );
    onReply?.(comment.id, displayName, within && text ? text : null);
  };

  // Вертикальная линия-коннектор идёт по КОЛОНКЕ АВАТАРОК (Notion-thread): от низа
  // аватара к верху аватара следующего коммента. Псевдо `after` на х=центр аватара
  // (size-7 → 14px), мостит зазор space-y-4 (-bottom-4); у последнего скрыта.
  return (
    <li
      id={`comment-${comment.id}`}
      className="group relative flex scroll-mt-4 items-start gap-3 after:absolute after:left-[14px] after:top-7 after:bottom-[-1rem] after:w-px after:-translate-x-1/2 after:bg-border/70 after:content-[''] last:after:hidden"
    >
      {isAgent ? (
        // Avatar заменён на «✻»-плашку — иконка Claude в peach-кружке, не путается с
        // юзер-аватаром Denis (он был источником путаницы в исходном issue).
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--claude-peach)' }}
        >
          <ClaudeIcon className="pf-claude-agent-icon" />
        </div>
      ) : (
        <Avatar className="size-7 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0 flex-1">
        {/* Шапка строки коммента — высотой с аватар (min-h-7, items-center), чтобы ник/
            время были по центру относительно аватара (раньше items-baseline «ронял» аву). */}
        <div className="flex min-h-7 items-center gap-2">
          {isAgent ? (
            // Notion-style: плоский комментарий без тонированной плиты; идентичность
            // агента — peach-аватар ✻ + имя цветом Claude + модель приглушённо.
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="pf-claude-agent-title truncate">
                {agentMeta(comment.agentName).name}
              </span>
              <span className="truncate text-[11px] text-muted-foreground/70">
                {agentMeta(comment.agentName).sub}
              </span>
            </span>
          ) : isSystem ? (
            <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              ⚙ Система
            </span>
          ) : (
            <span className="truncate text-[13px] font-medium">{displayName}</span>
          )}
          <span className="text-[11px] text-muted-foreground/70">
            {formatCommentTime(comment.createdAt)}
            {isEdited && <span className="ml-1 opacity-70">· изменён</span>}
          </span>
          {/* Действия — ровный ряд size-6 кнопок (карандаш + три точки). Удаление
              переехало в меню три-точки. Native title — подпись при наведении. */}
          <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {onReply && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                // onMouseDown (не onClick): успеваем считать выделение ДО его схлопывания.
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleReplyClick();
                }}
                aria-label="Ответить"
                title="Ответить (выдели текст для цитаты)"
              >
                <Reply className="size-3" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={enterEdit}
              aria-label="Редактировать"
              title="Редактировать"
            >
              <Pencil className="size-3" />
            </Button>
            <CommentActionsMenu
              projectId={projectId}
              taskId={taskId}
              comment={comment}
              onDelete={() => void remove()}
            />
          </div>
        </div>
        {/* Баннер «в ответ …» (db/080): клик → прокрутка+подсветка исходного коммента
            (и точечно — процитированного фрагмента). Приятная заливка. */}
        {comment.replyToCommentId && (
          <button
            type="button"
            onClick={() => onNavigateToComment?.(comment.replyToCommentId as string, comment.quotedText)}
            className="mt-1 flex max-w-full items-center gap-1.5 rounded-md border-l-2 border-primary/40 bg-primary/[0.06] px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-primary/10"
            title="Перейти к исходному комментарию"
          >
            <CornerDownRight className="size-3 shrink-0 text-primary/70" />
            <span className="truncate">
              в ответ <span className="font-medium text-foreground/80">{replyParentName ?? '…'}</span>
              {comment.quotedText ? <span className="text-muted-foreground/80">: «{comment.quotedText}»</span> : null}
            </span>
          </button>
        )}
        {editing ? (
          // WYSIWYG-правка комментария. Enter — сохранить, Shift+Enter — перенос,
          // Esc — отмена (capture). blur-save с no-op-guard внутри save() (если не менялось).
          <div className="mt-0.5" onKeyDownCapture={handleWrapperKeyDownCapture}>
            <Suspense fallback={<div className="text-sm leading-snug">{draft}</div>}>
              <RichTextEditor
                variant="comment"
                value={draft}
                onChange={setDraft}
                onSubmit={() => void save()}
                onBlur={() => void save()}
                members={mentionMembers}
                autoFocus
                disabled={saving}
                className="text-sm leading-snug"
              />
            </Suspense>
          </div>
        ) : (
          <div className="mt-0.5" ref={bodyRef}>
            <CommentBody body={comment.body} />
            {ralphQuestion && !answeredQids.has(ralphQuestion.qid) && (
              <RalphAnswerControls
                question={ralphQuestion}
                projectId={projectId}
                taskId={taskId}
                onCreated={onAnswerCreated}
              />
            )}
          </div>
        )}
        {comment.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {comment.attachments.map((att) =>
              isImageFile(att.mimeType, att.filename) ? (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => setPreview(att)}
                  className="size-14 overflow-hidden rounded border bg-muted"
                  aria-label={`Открыть ${att.filename}`}
                >
                  <img src={att.url} alt={att.filename} loading="lazy" className="size-full object-cover" />
                </button>
              ) : (
                <a
                  key={att.id}
                  href={att.url}
                  download={att.filename}
                  className="inline-flex items-center gap-1.5 rounded border bg-muted/50 px-2 py-1 text-[11px] hover:bg-muted"
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-[140px] truncate">{att.filename}</span>
                  <span className="text-muted-foreground">{formatBytes(att.sizeBytes)}</span>
                  <Download className="size-3 shrink-0 text-muted-foreground" />
                </a>
              ),
            )}
          </div>
        )}
      </div>
      <AttachmentLightbox attachment={preview} onClose={() => setPreview(null)} />
    </li>
  );
}

