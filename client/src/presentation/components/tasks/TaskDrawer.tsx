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
import { AppWindow, ArrowRight, Bot, CalendarClock, Check, ChevronDown, ChevronsLeftRight, ChevronsRight, ChevronsRightLeft, ChevronUp, Clock, CornerDownRight, Download, ExternalLink, FileText, Flag, FolderKanban, GripVertical, Loader2, Maximize2, Minimize2, MoreHorizontal, PanelRight, Paperclip, Pencil, Plus, Reply, RotateCcw, Send, Share2, Trash2, UploadCloud, UserPlus, type LucideIcon } from 'lucide-react';
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { type Task } from '@/domain/task/Task';
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
import type { Project } from '@/domain/project/Project';
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
import { TaskHeaderMedia, type TaskMediaPatch } from './TaskHeaderMedia';
import { splitTitleBody, parseTitleHeading, stripInlineMarkdown } from '@/lib/taskTitleBody';
import { TaskDrawerAttachmentRow } from './TaskDrawerAttachmentRow';
import { CancelWorkButton } from './CancelWorkButton';
import { STATUS_LABEL, ADVANCE_NEXT } from './statusLabels';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { useResizableWidth } from '@/presentation/hooks/useResizableWidth';
import { useSetRightPanelWidth } from '@/presentation/layout/rightPanelContext';
import { ResizeHandleHint } from '@/presentation/components/layout/ResizeHandleHint';
import { AiImproveButton } from '@/presentation/components/ai/AiImproveButton';
import type { MentionMember, RichTextEditorHandle } from '@/presentation/components/editor/RichTextEditor';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { ProjectPublishedBanner } from '@/presentation/components/project/ProjectPublishedBanner';
import { TaskVersionsDialog } from './TaskVersionsDialog';

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
  // Гейт редактирования содержимого (title/body/свойства/чекбоксы). false — read-only
  // просмотр (например, viewer открыл чужую пару из вкладки «Другим»); комментарии
  // этим НЕ гейтятся. Дефолт true — прежнее поведение всех существующих вызовов.
  canEdit?: boolean;
  // asPage — рендерить как отдельную страницу (не Sheet-оверлей): без модалки,
  // во всю высоту, с хлебными крошками сверху. Используется на /projects/:id/tasks/:taskId.
  asPage?: boolean;
  // Хлебные крошки для asPage-режима (строит вызывающая страница: проект → задача).
  breadcrumbs?: React.ReactNode;
  // Навигация пред/след по колонке (открыть задачу выше/ниже). undefined = кнопка неактивна.
  onPrev?: () => void;
  onNext?: () => void;
  // Подсветить тело задачи при открытии (переход из ленты активности по блоку изменения,
  // ?hl=<поле>). Значение — имя изменённого поля; на короткое время «мигаем» телом.
  highlightField?: string | null;
};

// localStorage-ключ режима ширины страницы задачи (asPage): '1' = во всю ширину.
const TASK_PAGE_WIDE_KEY = 'pf-task-page-wide';

// Режим «подглядывания» окна задачи (peek), как в Notion. Запоминается в localStorage —
// следующая открытая задача стартует в том же режиме. 'page'/'newtab' — одноразовые
// действия (навигация), в localStorage хранятся только layout-режимы 'right' | 'center'.
type PeekMode = 'right' | 'center';
const TASK_PEEK_MODE_KEY = 'pf-task-peek-mode';
function readPeekMode(): PeekMode {
  try {
    return localStorage.getItem(TASK_PEEK_MODE_KEY) === 'center' ? 'center' : 'right';
  } catch {
    return 'right';
  }
}

// Черновик формы создания задачи — переживает перезагрузку страницы (sessionStorage,
// пер-проект). Файлы (File-объекты) не сериализуются и в черновик не попадают.
type CreateDraft = {
  description: string;
  ralphMode: RalphMode;
  delegateUserId: string | null;
  deadline: string | null;
  priority: TaskPriority | null;
};
function readCreateDraft(key: string): CreateDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<CreateDraft>;
    if (typeof d?.description !== 'string') return null;
    return {
      description: d.description,
      ralphMode: (d.ralphMode as RalphMode) ?? 'normal',
      delegateUserId: d.delegateUserId ?? null,
      deadline: d.deadline ?? null,
      priority: (d.priority as TaskPriority) ?? null,
    };
  } catch {
    return null;
  }
}
function writeCreateDraft(key: string, draft: CreateDraft): void {
  try {
    // Пустой черновик не храним — чтобы свежее «+ создать» открывалось чистым.
    const empty =
      draft.description.trim() === '' &&
      draft.deadline === null &&
      draft.priority === null &&
      draft.delegateUserId === null &&
      draft.ralphMode === 'normal';
    if (empty) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* sessionStorage недоступен — черновик действует только на эту сессию */
  }
}
function clearCreateDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Обёртка содержимого дровера: в обычном режиме — Sheet-оверлей; в asPage —
// inline-страница во всю высоту с хлебными крошками и центрированной колонкой.
// Объявлена на уровне модуля (стабильный тип) — иначе пересоздание на каждый рендер
// ремонтировало бы всё поддерево (потеря фокуса/состояния редактора).
function DrawerShell({
  asPage,
  asPageWide,
  peekMode,
  breadcrumbs,
  topActions,
  open,
  onOpenChange,
  contentClassName,
  contentStyle,
  contentRef,
  dragHandlers,
  dragOverlay,
  children,
}: {
  asPage: boolean;
  // asPage: колонка во всю ширину (true) или центрированная читаемая колонка (false).
  asPageWide: boolean;
  // peek-режим окна-оверлея (не asPage): 'right' сбоку (немодально) | 'center' по центру (модально).
  peekMode: PeekMode;
  breadcrumbs: React.ReactNode;
  // asPage: кластер кнопок действий (закрыть/окном в проекте/ширина/статус/поделиться/⋯),
  // выровненный по ПРАВОМУ краю строки хлебных крошек. В окне-оверлее не используется.
  topActions?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentClassName: string;
  contentStyle: React.CSSProperties | undefined;
  // Ref на коробку окна (Sheet) — нужен, чтобы мерить ширину окна и центрировать плашку
  // «за окном» в видимой области. В asPage не используется.
  contentRef?: React.Ref<HTMLDivElement>;
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
        <div className="flex h-11 shrink-0 items-center gap-2 px-3 sm:px-6">
          {breadcrumbs}
          {topActions && (
            <div className="ml-auto flex shrink-0 items-center gap-0.5">{topActions}</div>
          )}
        </div>
        <div
          className={cn(
            'mx-auto grid w-full flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden',
            asPageWide ? 'max-w-none' : 'max-w-3xl',
          )}
        >
          {children}
        </div>
      </div>
    );
  }
  // center-peek — модальное окно по центру (Notion «center peek»): затемнение, клик мимо
  // закрывает. side-peek ('right') — немодально, клик мимо НЕ закрывает (тыкать весь сайт).
  const isCenter = peekMode === 'center';
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={isCenter}>
      {/* SheetContent уже position:fixed → служит containing-block'ом для absolute-оверлея,
          поэтому dragOverlay (absolute inset-0) покрывает ровно видимую коробку окна. */}
      <SheetContent
        ref={contentRef}
        side={isCenter ? 'center' : 'right'}
        dimmed={isCenter}
        showClose={false}
        className={cn(contentClassName, 'outline-none focus:outline-none focus-visible:outline-none')}
        style={contentStyle}
        // НЕ авто-фокусим контент при открытии — иначе на reload Radix ставит фокус на
        // кнопку закрытия (синее кольцо). И НЕ возвращаем фокус на контент при закрытии:
        // при disable редактора во время отправки коммента FocusScope иначе на миг
        // фокусит контент → у левого (единственного видимого) края мелькает чёрный outline.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // side-peek: немодально (как в Notion) — остальной сайт кликабелен, клик мимо окна НЕ
        // закрывает его (закрытие только кнопкой/Esc). center-peek: модально — клик мимо закрывает
        // (даём Radix обработать), поэтому preventDefault только в side-режиме.
        onInteractOutside={isCenter ? undefined : (e) => e.preventDefault()}
        onPointerDownOutside={isCenter ? undefined : (e) => e.preventDefault()}
        {...dragHandlers}
      >
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

  // Notion-style значение в ряду свойств: текстовая ghost-кнопка без иконок,
  // «Выбрать режим…» для дефолта / имя режима когда выбран (единый вид с дедлайном).
  return (
    <RalphModeSelect
      value={mode}
      onChange={(v) => void change(v)}
      disabled={saving || disabled}
      variant="ghost"
      className={className}
    />
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
      toast.success(`Передано: ${STATUS_LABEL[next]}`);
    } catch (err) {
      setStatus(prev);
      toast.error(`Не удалось сменить статус: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const next = ADVANCE_NEXT[status];
  return (
    // Сплит-пилюля статуса: левая часть — шаг на следующий статус (если есть), правая
    // (шеврон) — выпадашка с любым статусом. Одна цельная «таблетка» в тон колонке.
    <div
      className={cn(
        'inline-flex shrink-0 items-center overflow-hidden rounded-full text-xs font-medium',
        STATUS_BADGE_COLOR[status],
        saving && 'opacity-50',
      )}
    >
      {next ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void change(next)}
          title={`Передать в «${STATUS_LABEL[next]}»`}
          className="inline-flex items-center gap-1 py-1 pl-2.5 pr-1.5 transition-[filter,transform] hover:brightness-95 active:scale-[0.97] disabled:opacity-50"
        >
          {STATUS_LABEL[status]}
          <ArrowRight className="size-3 opacity-60" />
        </button>
      ) : (
        <span className="py-1 pl-2.5 pr-1.5">{STATUS_LABEL[status]}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={saving}
            aria-label="Сменить статус"
            className="inline-flex items-center border-l border-black/10 py-1 pl-1 pr-2 transition-[filter,transform] hover:brightness-95 active:scale-[0.97] disabled:opacity-50 dark:border-white/15"
          >
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
    </div>
  );
}

// Подменю «Перенести в проект» внутри ⋯-меню задачи (раньше было отдельной пилюлей в шапке —
// теперь убрано в меню, чтобы не загромождать кластер кнопок). Сервер: MoveTaskToProject
// (из именованного — move_task, из инбокса — owner; активная делегация архивируется).
function MoveToProjectSubmenu({
  task,
  onMoved,
}: {
  task: Task;
  onMoved: () => void;
}): React.ReactElement {
  const { projectRepository, taskRepository } = useContainer();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = (): void => {
    if (projects !== null) return;
    projectRepository
      .list()
      .then((list) => setProjects(list.filter((p) => !p.isInbox)))
      .catch(() => setProjects([]));
  };

  const move = async (target: Project): Promise<void> => {
    if (saving || target.id === task.projectId) return;
    if (!window.confirm(`Перенести задачу в «${target.name}»?`)) return;
    setSaving(true);
    try {
      await taskRepository.assignToProject(task.projectId, task.id, target.id);
      toast.success(`Задача перенесена в «${target.name}»`);
      onMoved();
    } catch (e) {
      toast.error(`Не удалось перенести: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DropdownMenuSub onOpenChange={(open) => open && load()}>
      <DropdownMenuSubTrigger>
        <FolderKanban className="text-muted-foreground" /> Перенести в проект
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 min-w-[220px] overflow-y-auto">
        {projects === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Загрузка…</div>
        ) : projects.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Нет проектов</div>
        ) : (
          projects.map((p) => (
            <DropdownMenuItem key={p.id} disabled={p.id === task.projectId || saving} onClick={() => void move(p)}>
              <span className="truncate">{p.name}</span>
              {p.id === task.projectId && <Check className="ml-auto size-3.5 shrink-0 opacity-60" />}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
  canEdit: canEditProp = true,
  asPage = false,
  breadcrumbs = null,
  onPrev,
  onNext,
  highlightField = null,
}: Props): React.ReactElement {
  const { user: currentUser } = useCurrentUser();
  const { taskRepository, recordTaskView, userRepository } = useContainer();
  // Флеш-подсветка тела при переходе из ленты активности (?hl=<поле>): мигаем ~1.8с.
  const [flashBody, setFlashBody] = React.useState(false);
  React.useEffect(() => {
    if (!highlightField) return;
    setFlashBody(true);
    const t = window.setTimeout(() => setFlashBody(false), 1800);
    return () => window.clearTimeout(t);
  }, [highlightField]);
  const flashCls = flashBody
    ? 'rounded-lg ring-2 ring-primary/60 ring-offset-2 ring-offset-background transition-shadow duration-500'
    : 'transition-shadow duration-500';
  const navigate = useNavigate();
  // Единый hover-зоны сверху: верхние кнопки (peek/пред-след) И кнопки «Добавить иконку/обложку»
  // проявляются ВМЕСТЕ при наведении на любую из них. Небольшая задержка ухода — чтобы переход
  // между зонами (через плашку) не гасил их. См. renderTopHoverControls + TaskHeaderMedia.
  const [topZoneHover, setTopZoneHover] = useState(false);
  // Окно «История версий» этой задачи (открывается из меню ⋯). Только edit-mode.
  const [versionsOpen, setVersionsOpen] = useState(false);
  const topZoneTimer = useRef<number | undefined>(undefined);
  const enterTopZone = useCallback((): void => {
    if (topZoneTimer.current) window.clearTimeout(topZoneTimer.current);
    setTopZoneHover(true);
  }, []);
  const leaveTopZone = useCallback((): void => {
    if (topZoneTimer.current) window.clearTimeout(topZoneTimer.current);
    topZoneTimer.current = window.setTimeout(() => setTopZoneHover(false), 150);
  }, []);
  // Ширина колонки на отдельной странице задачи (asPage): по центру (читаемая колонка)
  // или во всю ширину. Запоминаем в localStorage — следующая открытая страница задачи
  // стартует в том же режиме. На обычное окно-оверлей не влияет.
  const [asPageWide, setAsPageWide] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TASK_PAGE_WIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleAsPageWide = useCallback((): void => {
    setAsPageWide((v) => {
      const next = !v;
      try {
        localStorage.setItem(TASK_PAGE_WIDE_KEY, next ? '1' : '0');
      } catch {
        /* localStorage недоступен — режим действует только на эту сессию */
      }
      return next;
    });
  }, []);
  // Peek-режим окна: 'right' (сбоку, немодально, ресайз) | 'center' (по центру, модально).
  // Запоминается в localStorage. 'page'/'newtab' — одноразовая навигация (не хранится).
  const [peekMode, setPeekModeState] = useState<PeekMode>(readPeekMode);
  const setPeekMode = useCallback((next: PeekMode): void => {
    setPeekModeState(next);
    try {
      localStorage.setItem(TASK_PEEK_MODE_KEY, next);
    } catch {
      /* localStorage недоступен — режим действует только на эту сессию */
    }
  }, []);
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
  // Ключ черновика create-формы — пер-проект (для inbox aiProjectId=null → 'inbox').
  const createDraftKey = `pf-task-create-draft:${aiProjectId ?? 'inbox'}`;
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
  // Черновик create-формы для кнопки «Восстановить»: снимок прошлого закрытия/reload + флаг
  // показа кнопки. restoreArmed — защита, чтобы только что открытая ПУСТАЯ форма не затёрла
  // сохранённый черновик (сохранение идёт на каждое изменение полей).
  const createStashRef = useRef<CreateDraft | null>(null);
  const restoreArmedRef = useRef(false);
  const [showRestore, setShowRestore] = useState(false);
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
  // Исходное описание задачи на момент открытия — чтобы НЕ слать update (и не бампить
  // updatedAt → не выталкивать задачу наверх) при простом открытии/переключении без правок.
  const originalEditDescRef = useRef('');
  useEffect(() => {
    if (state?.mode === 'edit') {
      setEditDescription(state.task.description ?? '');
      originalEditDescRef.current = state.task.description ?? '';
    } else setEditDescription('');
    // Пере-сеем только при смене задачи (id) или режима — правки в открытом дровере
    // не должны сбрасываться родительским refetch'ем (он не меняет task.description здесь).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTaskId, state?.mode]);

  // Единый путь сохранения описания (title+body) → taskRepository.update. Возвращаемое
  // описание становится новым источником правды (на случай нормализации сервером).
  // No-op, если ничего не изменилось ОТНОСИТЕЛЬНО ПОСЛЕДНЕГО СОХРАНЁННОГО значения
  // (originalEditDescRef), а не текущего editDescription — иначе commitDescription(editDescription)
  // на blur был бы no-op и правки/вставленные картинки сохранялись бы только на закрытии окна
  // (терялись на reload, аттач «осиротевал» в «Файлы»).
  const commitDescription = useCallback(
    async (nextDescription: string): Promise<void> => {
      if (state?.mode !== 'edit') return;
      const { projectId, id } = state.task;
      const trimmed = nextDescription.trim();
      // Заголовок (1-я строка) обязателен: пустое описание — не сохраняем (как прежде).
      if (splitTitleBody(trimmed).title.length === 0) return;
      if (trimmed === originalEditDescRef.current.trim()) return;
      setEditSaving(true);
      try {
        const updated = await taskRepository.update(projectId, id, { description: trimmed });
        setEditDescription(updated.description ?? '');
        originalEditDescRef.current = updated.description ?? '';
        notifyChanged();
      } catch (e) {
        toast.error(`Не удалось сохранить: ${(e as Error).message}`);
      } finally {
        setEditSaving(false);
      }
    },
    [state, taskRepository, notifyChanged],
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
  const stickyBarRef = useRef<HTMLButtonElement>(null);
  const [showStickyTitle, setShowStickyTitle] = useState(false);
  // Зеркало текущего состояния для гистерезиса в compute (без переподписки слушателей).
  const showStickyRef = useRef(false);
  useEffect(() => {
    showStickyRef.current = showStickyTitle;
  }, [showStickyTitle]);
  useEffect(() => {
    if (state?.mode !== 'edit') {
      setShowStickyTitle(false);
      return;
    }
    // Прямое сравнение позиций вместо IntersectionObserver: надёжнее при смене
    // split↔narrow (скролл-контейнер — разный элемент) и при ленивой подгрузке тела.
    // Скролл-контейнер ищем заново на каждом вызове — это ближайший scrollable-предок
    // сентинела; sticky показываем, когда сентинел доехал до верха контейнера.
    const compute = (): void => {
      const el = titleSentinelRef.current;
      if (!el) return;
      let root: HTMLElement | null = el.parentElement;
      while (root) {
        const oy = getComputedStyle(root).overflowY;
        if (oy === 'auto' || oy === 'scroll') break;
        root = root.parentElement;
      }
      const topRef = root ? root.getBoundingClientRect().top : 0;
      const top = el.getBoundingClientRect().top;
      // Гистерезис: появление sticky-бара сдвигает контент вниз на свою высоту (бар —
      // первый ребёнок ленты). Без буфера это перещёлкивало бы show/hide на пороге.
      // Показываем, когда сентинел доехал до верха; скрываем только когда он ушёл ниже
      // верха больше чем на высоту бара — т.е. реально вернулись к началу задачи.
      if (showStickyRef.current) {
        const barH = stickyBarRef.current?.offsetHeight ?? 0;
        if (top > topRef + barH + 8) setShowStickyTitle(false);
      } else if (top <= topRef) {
        setShowStickyTitle(true);
      }
    };
    const raf = requestAnimationFrame(compute);
    // capture-фаза: события скролла не всплывают, ловим скролл ЛЮБОГО контейнера.
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [state?.mode, openTaskId]);
  const scrollToTaskTop = (): void => {
    // К САМОМУ верху скролл-контейнера (а не к сентинелу, который ниже шапки), чтобы
    // закрепление полностью пропало и были видны шапка + первая строка задачи.
    let root: HTMLElement | null = titleSentinelRef.current?.parentElement ?? null;
    while (root) {
      const oy = getComputedStyle(root).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      root = root.parentElement;
    }
    root?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Сохранение/восстановление позиции скролла окна задачи — переживает перезагрузку:
  // после reload (когда окно восстановлено) возвращаемся ровно туда, где скроллили.
  // Ключ — по taskId. Чистится при явном закрытии окна (см. handleClose).
  useEffect(() => {
    if (state?.mode !== 'edit' || !editTaskId) return;
    const key = `pf-task-scroll:${editTaskId}`;
    const findRoot = (): HTMLElement | null => {
      let root: HTMLElement | null = titleSentinelRef.current?.parentElement ?? null;
      while (root) {
        const oy = getComputedStyle(root).overflowY;
        if (oy === 'auto' || oy === 'scroll') break;
        root = root.parentElement;
      }
      return root;
    };
    const onScroll = (): void => {
      const r = findRoot();
      if (r) {
        try {
          sessionStorage.setItem(key, String(Math.round(r.scrollTop)));
        } catch {
          /* ignore */
        }
      }
    };
    let saved = 0;
    try {
      saved = Number.parseInt(sessionStorage.getItem(key) ?? '0', 10) || 0;
    } catch {
      /* ignore */
    }
    let raf = 0;
    let tries = 0;
    // Тело подгружается лениво — восстанавливаем scrollTop, как только контент дорос
    // до нужной высоты (или после разумного числа кадров — fallback).
    const tryRestore = (): void => {
      const r = findRoot();
      if (r && (r.scrollHeight - r.clientHeight >= saved || tries > 40)) {
        r.scrollTop = saved;
        window.addEventListener('scroll', onScroll, true);
        return;
      }
      tries += 1;
      raf = requestAnimationFrame(tryRestore);
    };
    if (saved > 0) raf = requestAnimationFrame(tryRestore);
    else window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [state?.mode, editTaskId]);

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
      // Ничего не правили — НЕ шлём update: иначе сервер бампит updatedAt и задача
      // всплывает наверх «как отредактированная» при простом открытии/переключении.
      if (trimmed === originalEditDescRef.current.trim()) return;
      // Fire-and-forget — компонент уже размонтируется.
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
    if (state.mode === 'edit') {
      setDescription(state.task.description ?? '');
      setCreateRalphMode('normal');
      setCreateDelegateUserId(null);
      setCreateDeadline(null);
      setCreatePriority(null);
    } else {
      // create: НЕ авто-подставляем прошлый черновик — открываем ПУСТЫМ и предлагаем кнопку
      // «Восстановить» (она появляется, только если черновик остался = задачу не создали).
      const draft = readCreateDraft(createDraftKey);
      createStashRef.current = draft;
      restoreArmedRef.current = draft !== null; // защита: пустая форма не затрёт черновик
      setShowRestore(draft !== null);
      setDescription('');
      setCreateRalphMode('normal');
      setCreateDelegateUserId(null);
      setCreateDeadline(null);
      setCreatePriority(null);
    }
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
  }, [state, createDraftKey]);

  // Сохраняем черновик create-формы при каждом изменении полей — чтобы при перезагрузке
  // страницы введённое не пропало. На пустой форме черновик удаляется (см. writeCreateDraft).
  useEffect(() => {
    if (state?.mode !== 'create') return;
    // Пока показываем «Восстановить» и форму ещё не трогали — НЕ перезаписываем сохранённый
    // черновик пустыми полями. Как только пользователь начал печатать «с нуля» — снимаем
    // защиту и прячем кнопку (новый ввод становится черновиком).
    if (restoreArmedRef.current) {
      const untouched =
        description.trim() === '' &&
        createDeadline === null &&
        createPriority === null &&
        createDelegateUserId === null &&
        createRalphMode === 'normal';
      if (untouched) return;
      restoreArmedRef.current = false;
      setShowRestore(false);
    }
    writeCreateDraft(createDraftKey, {
      description,
      ralphMode: createRalphMode,
      delegateUserId: createDelegateUserId,
      deadline: createDeadline,
      priority: createPriority,
    });
  }, [
    state?.mode,
    description,
    createRalphMode,
    createDelegateUserId,
    createDeadline,
    createPriority,
    createDraftKey,
  ]);

  // «Восстановить»: возвращаем прошлый черновик create-формы (текст, дедлайн, приоритет,
  // режим, делегат). Файлы/inline-картинки в персистентный черновик не входят.
  const handleRestoreCreateDraft = (): void => {
    const d = createStashRef.current;
    if (!d) return;
    setDescription(d.description);
    setCreateRalphMode(d.ralphMode);
    setCreateDelegateUserId(d.delegateUserId);
    setCreateDeadline(d.deadline);
    setCreatePriority(d.priority);
    restoreArmedRef.current = false;
    setShowRestore(false);
  };

  // Закрытие окна: в create-режиме явный «крестик»/клик-вне сбрасывает черновик
  // (перезагрузка — нет: она не вызывает onClose). Затем — обычное закрытие.
  const handleClose = useCallback((): void => {
    // create: черновик НЕ стираем на закрытии — он нужен для кнопки «Восстановить» при
    // следующем открытии (чистится только на успешном создании задачи, см. handleSubmit).
    // Явное закрытие — сбрасываем сохранённый скролл, чтобы следующее открытие этой
    // задачи стартовало сверху (перезагрузка onClose не вызывает → скролл сохраняется).
    if (state?.mode === 'edit' && editTaskId) {
      try {
        sessionStorage.removeItem(`pf-task-scroll:${editTaskId}`);
      } catch {
        /* ignore */
      }
    }
    onClose();
  }, [state?.mode, editTaskId, onClose]);

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

  // Инлайн-картинки (Ctrl+V скрин → блок в позицию). В edit-режиме грузим сразу в задачу и
  // возвращаем URL вложения. В create-режиме задачи ещё нет — отдаём временный blob:-URL для
  // мгновенного превью и запоминаем файл; реальная загрузка + замена blob→URL произойдёт на
  // submit (см. handleSubmit). Ключ карты — blob:-URL, он же стоит в markdown-описании.
  const inlineImagesRef = useRef<Map<string, File>>(new Map());
  const uploadImageInline = async (
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<string | null> => {
    if (state?.mode === 'edit') {
      const { projectId, id } = state.task;
      try {
        const att = await taskRepository.uploadAttachment(projectId, id, file, (loaded, total) => {
          onProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        });
        notifyChanged();
        refetchHeaderAttachments();
        return att.url;
      } catch (err) {
        toast.error(`Не удалось загрузить ${file.name}: ${(err as Error).message}`);
        return null;
      }
    }
    // create: превью через blob:-URL, реальная загрузка отложена до создания задачи.
    const blobUrl = URL.createObjectURL(file);
    inlineImagesRef.current.set(blobUrl, file);
    onProgress(100);
    return blobUrl;
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

  // Inline-картинку убрали из тела (backspace/delete) → удаляем и её вложение. В edit-режиме
  // картинка при вставке уже загружена как attachment (src ноды = att.url), иначе она бы
  // «оставалась в прикреплённых» после удаления из текста. Ищем по url; не нашли — no-op.
  const handleInlineImageRemoved = (src: string): void => {
    if (state?.mode !== 'edit') return;
    const att = headerAttachments.find((a) => a.url === src);
    if (att) deleteAttachmentDirectly(att);
  };

  // Картинки, вставленные ИНЛАЙН в тело (Ctrl+V), хранятся как attachments (src ноды = att.url).
  // В ряду «Файлы» их дублировать не нужно — они уже видны в тексте. Иначе фото появлялось и в
  // теле, и в списке файлов («фотки странно прикрепляются»). Прячем инлайн-картинки из ряда.
  const inlineImageSrcs = React.useMemo(() => {
    const set = new Set<string>();
    const unescape = (s: string): string =>
      s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const re = /<img[^>]+src="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(editDescription)) !== null) set.add(unescape(m[1]));
    return set;
  }, [editDescription]);
  const filesRowAttachments = React.useMemo(
    () => headerAttachments.filter((a) => !inlineImageSrcs.has(a.url)),
    [headerAttachments, inlineImageSrcs],
  );

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
      // Инлайн-картинки (create): грузим отложенные blob-скрины в новую задачу и заменяем
      // временные blob:-URL на реальные URL вложений прямо в тексте описания.
      if (state?.mode === 'create' && inlineImagesRef.current.size > 0) {
        let desc = description.trim();
        let changed = false;
        for (const [blobUrl, file] of inlineImagesRef.current) {
          if (desc.includes(blobUrl)) {
            try {
              const att = await taskRepository.uploadAttachment(task.projectId, task.id, file);
              desc = desc.split(blobUrl).join(att.url);
              changed = true;
            } catch (err) {
              toast.error(`Не удалось загрузить картинку: ${(err as Error).message}`);
            }
          }
          URL.revokeObjectURL(blobUrl);
        }
        inlineImagesRef.current.clear();
        if (changed) {
          try {
            await taskRepository.update(task.projectId, task.id, { description: desc });
            notifyChanged();
          } catch (err) {
            toast.error(`Не удалось сохранить картинки в описании: ${(err as Error).message}`);
          }
        }
      }
      // Задача создана — черновик больше не нужен.
      if (state?.mode === 'create') clearCreateDraft(createDraftKey);
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
      className="group/x size-7 shrink-0 text-muted-foreground hover:text-foreground sm:size-7"
      onClick={handleClose}
      aria-label="Закрыть"
      title="Закрыть"
    >
      <ChevronsRight className="size-3.5 transition-transform duration-200 group-hover/x:translate-x-0.5" />
    </Button>
  );

  // Кнопка «развернуть/свернуть окно» — рядом с кнопкой закрытия. В обычном окне-оверлее
  // открывает задачу ОТДЕЛЬНОЙ СТРАНИЦЕЙ (/projects/:id/tasks/:taskId). На самой странице
  // НЕ исчезает (по просьбе): сворачивает обратно в окно-оверлей внутри проекта
  // (/projects/:id?task=:taskId) — задача не закрывается, просто открывается окном, как было.
  const renderMaximizeButton = (): React.ReactElement | null => {
    const pageTask = state?.mode === 'edit' ? state.task : null;
    if (!pageTask || !isDesktop) return null;
    if (asPage) {
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground sm:size-7"
          onClick={() => navigate(`/projects/${pageTask.projectId}?task=${pageTask.id}`)}
          aria-label="Открыть окном в проекте"
          title="Открыть окном в проекте"
        >
          <Minimize2 className="size-3.5" />
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground sm:size-7"
        onClick={() => navigate(`/projects/${pageTask.projectId}/tasks/${pageTask.id}`)}
        aria-label="Развернуть на весь экран"
        title="Развернуть на весь экран"
      >
        <Maximize2 className="size-3.5" />
      </Button>
    );
  };

  // Переключатель ширины колонки на странице задачи (asPage): по центру ↔ во всю ширину.
  // Режим запоминается (localStorage), следующая открытая страница задачи стартует так же.
  const renderPageWidthToggle = (): React.ReactElement | null => {
    if (!asPage || !isDesktop) return null;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground sm:size-7"
        onClick={toggleAsPageWide}
        aria-label={asPageWide ? 'Колонка по центру' : 'Во всю ширину'}
        title={asPageWide ? 'Колонка по центру' : 'Во всю ширину'}
      >
        {asPageWide ? (
          <ChevronsRightLeft className="size-3.5" />
        ) : (
          <ChevronsLeftRight className="size-3.5" />
        )}
      </Button>
    );
  };

  // Переключатель peek-режима окна (Notion «Open in»): сбоку / по центру / отдельная
  // страница / новая вкладка. Первые два — layout-режимы (запоминаются), последние два —
  // одноразовая навигация. Только desktop-оверлей (в asPage/мобиле не показываем).
  const renderPeekSwitcher = (): React.ReactElement | null => {
    const swTask = state?.mode === 'edit' ? state.task : null;
    if (!swTask || asPage || !isDesktop) return null;
    const taskUrl = `/projects/${swTask.projectId}/tasks/${swTask.id}`;
    const CurrentIcon = peekMode === 'center' ? AppWindow : PanelRight;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground sm:size-7"
            aria-label="Режим окна"
            title="Режим окна"
          >
            <CurrentIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[210px]">
          <DropdownMenuItem onSelect={() => setPeekMode('right')}>
            <PanelRight className="text-muted-foreground" />
            <span className="flex-1">Сбоку</span>
            {peekMode === 'right' && <Check className="size-4 text-foreground" />}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPeekMode('center')}>
            <AppWindow className="text-muted-foreground" />
            <span className="flex-1">По центру</span>
            {peekMode === 'center' && <Check className="size-4 text-foreground" />}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(taskUrl)}>
            <Maximize2 className="text-muted-foreground" />
            <span className="flex-1">Отдельной страницей</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              try {
                window.open(taskUrl, '_blank', 'noopener');
              } catch {
                /* окно недоступно */
              }
            }}
          >
            <ExternalLink className="text-muted-foreground" />
            <span className="flex-1">Открыть в новой вкладке</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Hover-контролы в ТОПБАРЕ (Notion-style): при наведении на верхнюю панель после кнопок
  // закрыть/развернуть проявляются | линия | переключатель peek | линия | пред/след.
  // Пред/след всегда видны (серые/неактивные, если нет соседа по колонке). Пока открыт
  // dropdown peek-режима — кластер не гаснет. Только desktop-оверлей.
  const renderTopHoverControls = (): React.ReactElement | null => {
    if (asPage || !isDesktop) return null;
    return (
      <div
        className={cn(
          'flex items-center gap-1 transition-opacity duration-150 focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
          topZoneHover ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
        {renderPeekSwitcher()}
        <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={!onPrev}
            onClick={onPrev}
            aria-label="Предыдущая задача"
            title="Предыдущая задача (задача выше)"
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={!onNext}
            onClick={onNext}
            aria-label="Следующая задача"
            title="Следующая задача (задача ниже)"
          >
            <ChevronDown className="size-4" />
          </Button>
        </div>
      </div>
    );
  };

  const task = state?.mode === 'edit' ? state.task : null;
  const scrollToCommentId = state?.mode === 'edit' ? state.scrollToCommentId : undefined;
  // Контекст ответа/цитаты: выбран в треде (кнопка «Ответить» / выделение), читается
  // композером-футером (плашка «в ответ …») и уходит в createComment. db/080.
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);
  // Редактируем задачу в ЛЮБОМ статусе, включая done (по требованию: «задача всегда
  // редактируема» — плюсики, свойства, тело и кнопки доступны и для выполненных).
  // canEditProp сверху может опустить в read-only (viewer на чужой задаче) — иначе
  // окно выглядело бы редактируемым, а каждый save падал бы 403-ей.
  const canEdit = !!task && canEditProp;

  // Сохранить медиа-поля (иконка/обложка/положение обложки). Оптимистичный показ живёт в
  // TaskHeaderMedia; здесь только PATCH + оповещение. Ошибка — тост (локальный показ уже стоит).
  const saveMedia = useCallback(
    (patch: TaskMediaPatch): void => {
      const t = state?.mode === 'edit' ? state.task : null;
      if (!t) return;
      void taskRepository
        .update(t.projectId, t.id, patch)
        .then(() => notifyChanged())
        .catch((e) => toast.error(`Не удалось сохранить: ${(e as Error).message}`));
    },
    [state, taskRepository, notifyChanged],
  );

  // === Resizable + split drawer (EDIT-mode, desktop only) ===
  // Coarse pointer / narrow viewport → resize disabled, keep default full-width
  // stacked Sheet (mobile untouched). `md` breakpoint is 768px (Tailwind default).
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isFinePointer = useMediaQuery('(pointer: fine)');
  // Resizable + split — на десктопе (edit И create). НЕ завязываем на state.mode: иначе при
  // закрытии (state→null) инлайн-ширина мгновенно слетала на дефолтные 900px → окно «дёргано»
  // расширялось перед закрытием. Без mode-гейта ширина держится всю анимацию закрытия.
  // В asPage (отдельная страница) ресайз не нужен — фиксированная центрированная колонка.
  // В center-peek (модальное окно по центру) ресайз тоже выключен — фиксированный размер.
  const resizeEnabled = !asPage && peekMode === 'right' && isDesktop && isFinePointer;
  const { width, dragging, isSplit: isSplitRaw, onHandlePointerDown } =
    useResizableWidth(
      resizeEnabled,
      state !== null,
      () => {
        // Дотянули окно до самого края — открываем задачу отдельной страницей.
        if (state?.mode === 'edit') {
          navigate(`/projects/${state.task.projectId}/tasks/${state.task.id}`);
        }
      },
      // Клик по границе (без тяги) — закрыть окно.
      () => handleClose(),
    );
  // В asPage — всегда одна центрированная колонка (Notion-style страница), без split.
  const isSplit = asPage ? false : isSplitRaw;

  // Окно редактирования — чистый ОВЕРЛЕЙ (как окно активности): просто перекрывает главный
  // экран и НЕ сдвигает/не сужает его. Поэтому ширину в AppShell НЕ публикуем (всегда 0).
  const setRightPanelWidth = useSetRightPanelWidth();
  React.useEffect(() => {
    setRightPanelWidth(0);
    return () => setRightPanelWidth(0);
  }, [setRightPanelWidth]);

  // Сигналим главному окну, что окно задачи открыто/закрыто — чтобы оно спрятало свои
  // верхние действия (Изменено/Поделиться/⋯): они уже есть в шапке окна (overlay сверху).
  React.useEffect(() => {
    const open = state !== null && !asPage;
    window.dispatchEvent(new CustomEvent('pf:task-drawer-open', { detail: { open } }));
    return () => {
      window.dispatchEvent(new CustomEvent('pf:task-drawer-open', { detail: { open: false } }));
    };
  }, [state, asPage]);

  // Закреплённый укороченный заголовок при скролле. Клик — к началу задачи. Рендерим
  // как первый ребёнок РЕАЛЬНОГО скролл-контейнера: в narrow это внешний контейнер
  // (заголовок держится сквозь тело → комменты → LIVE до самого низа), в split —
  // левая колонка (у неё свой скролл).
  const stickyTitleBar = showStickyTitle ? (
    <button
      ref={stickyBarRef}
      type="button"
      onClick={scrollToTaskTop}
      title="К началу задачи"
      className={cn(
        // Непрозрачный фон (без /95 и backdrop-blur) — иначе сквозь «фрост» просвечивал
        // скроллящийся контент и на hover казалось, что фон пропадает. Hover — мягкий
        // СПЛОШНОЙ серый (bg-muted), а не полупрозрачный оверлей.
        'sticky top-0 z-20 block w-full shrink-0 border-b bg-background px-[var(--pf-drawer-px)] py-2 text-left',
        'cursor-pointer transition-colors hover:bg-muted',
        animations && 'duration-150 animate-in fade-in-0 slide-in-from-top-1',
      )}
    >
      <span className="line-clamp-4 text-sm font-medium leading-snug text-foreground">
        {stripInlineMarkdown(parseTitleHeading(splitTitleBody(editDescription).title).text) ||
          'Без названия'}
      </span>
    </button>
  ) : null;

  // #6: плашка публикации наезжает и на окно задачи (edit/create) — контент съезжает ниже.
  // Только в Sheet-режиме и не для inbox (у него нет опубликованного сайта).
  const bannerProjectId =
    asPage || isInbox ? null : state?.mode === 'edit' ? state.task.projectId : aiProjectId;

  // Правый кластер задачных действий (проект + статус + Поделиться + ⋯). Общий для
  // окна-оверлея (шапка) и отдельной страницы (строка хлебных крошек) — единый источник.
  const statusShareMore = task ? (
    <>
      {/* Проект-пилюля убрана из шапки (загромождала кластер) — «Перенести в проект» теперь
          в ⋯-меню (MoveToProjectSubmenu). В шапке остаётся только статус + Поделиться + ⋯. */}
      {/* Статус — единая сплит-пилюля (шаг вперёд + выпадашка) = «передать в другой канбан». */}
      {onMove ? (
        <TaskStatusChip task={task} onMove={onMove} onChanged={() => notifyChanged()} />
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
      {/* Поделиться = копировать ссылку на задачу (U3): раньше кнопка была без onClick
          (мёртвая), а «Копировать ссылку» дублировалось в ⋯. Теперь Share копирует, а
          дубль из меню убран. Async-copy с await+catch — корректный success/failure. */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        aria-label="Скопировать ссылку на задачу"
        onClick={() => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(
                `${window.location.origin}/projects/${task.projectId}/tasks/${task.id}`,
              );
              toast.success('Ссылка на задачу скопирована');
            } catch {
              toast.error('Не удалось скопировать ссылку');
            }
          })();
        }}
      >
        <Share2 className="size-4" />
        {/* На телефонах — только иконка: вместе с парой пилюль текст не влезает. */}
        <span className="hidden text-sm sm:inline">Поделиться</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            aria-label="Ещё"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          {/* Перенос задачи в другой проект — переехал сюда из шапки. */}
          {onMove && (
            <MoveToProjectSubmenu
              task={task}
              onMoved={() => {
                notifyChanged();
                handleClose();
              }}
            />
          )}
          {/* История версий — все изменения этой задачи (снимки на create/update/move/restore). */}
          <DropdownMenuItem onSelect={() => setVersionsOpen(true)}>
            <Clock className="text-muted-foreground" /> История версий
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaskVersionsDialog
        projectId={task.projectId}
        taskId={task.id}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
      />
    </>
  ) : null;

  // asPage: весь кластер кнопок уезжает в строку хлебных крошек, выровненный по правому краю,
  // в порядке: закрыть → открыть окном в проекте → ширина → статус → Поделиться → ⋯.
  const pageTopActions =
    asPage && task ? (
      <>
        {renderCloseButton()}
        {renderMaximizeButton()}
        {renderPageWidthToggle()}
        {statusShareMore}
      </>
    ) : null;

  // Окно — чистый ОВЕРЛЕЙ (point 1): на главном экране ничего не сдвигаем, поэтому ширину
  // окна в --pf-drawer-open-w НЕ публикуем (держим 0) — плашка «проект опубликован» не съезжает.
  const setDrawerBox = useCallback((): void => {
    document.documentElement.style.setProperty('--pf-drawer-open-w', '0px');
  }, []);

  return (
    <DrawerShell
      contentRef={setDrawerBox}
      asPage={asPage}
      asPageWide={asPageWide}
      peekMode={peekMode}
      breadcrumbs={breadcrumbs}
      topActions={pageTopActions}
      open={state !== null}
      onOpenChange={(open) => !open && handleClose()}
      contentClassName={cn(
        'grid gap-0 overflow-hidden p-0 grid-rows-[minmax(0,1fr)]',
        // center-peek: фиксированное окно по центру (85vh, читаемая ширина). side-peek: во всю
        // высоту, у правого края, ресайзится.
        peekMode === 'center' && !asPage
          ? 'h-[85vh] max-h-[85vh] w-[min(92vw,900px)]'
          : 'h-dvh w-full sm:max-w-[900px]',
        dragging && '!transition-none',
      )}
      contentStyle={resizeEnabled ? { width: `${width}px`, maxWidth: '96vw' } : undefined}
      dragHandlers={dragHandlers}
      dragOverlay={dragOverlay}
    >
        {/* Drag-ручка на ЛЕВОМ крае дравера (тонкая вертикальная полоса). Тянем
            влево — шире, вправо — уже. Только desktop (resizeEnabled). */}
        {resizeEnabled && (
          <ResizeHandleHint side="left" action="Закрыть" shortcut="Клик">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Изменить ширину окна или закрыть"
              onPointerDown={onHandlePointerDown}
              className={cn(
                'group/resize absolute inset-y-0 left-0 z-50 w-1.5 -translate-x-1/2 cursor-col-resize touch-none',
                'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors',
                'hover:before:bg-primary/40',
                dragging && 'before:bg-primary/60',
              )}
            />
          </ResizeHandleHint>
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
          <div className="relative flex h-full min-h-0 flex-col overflow-hidden [--pf-drawer-px:1rem] sm:[--pf-drawer-px:3.25rem] lg:[--pf-drawer-px:4rem]">
            {/* #3: верхняя панель + плашка — ОБЩАЯ ШАПКА НА ВСЮ ШИРИНУ окна (над обоими
                столбцами в split), поэтому в split-режиме плашка идёт через оба столбца, а
                кнопки закрыть/развернуть/статус — по всей ширине шапки. В asPage этой шапки
                НЕТ — весь кластер кнопок живёт в строке хлебных крошек (см. pageTopActions). */}
            {!asPage && (
              <div
                className="flex h-11 shrink-0 items-center gap-1 bg-background/95 pr-3"
                onMouseEnter={enterTopZone}
                onMouseLeave={leaveTopZone}
              >
                {/* Кнопки закрыть/развернуть — по ЦЕНТРУ левого отступа окна (Notion-style):
                    бокс шириной ровно с левый отступ контента, кнопки в нём центрированы. */}
                <div className="flex shrink-0 items-center justify-center gap-0.5 min-w-[var(--pf-drawer-px)]">
                  {renderCloseButton()}
                  {renderMaximizeButton()}
                  {renderPageWidthToggle()}
                </div>
                {/* При наведении на топбар — | линия | peek-режим | линия | пред/след (Notion-style). */}
                {renderTopHoverControls()}
                {/* Название проекта и хеш убраны — спейсер отправляет действия/статус к правому краю. */}
                <div className="min-w-0 flex-1" />
                {statusShareMore}
              </div>
            )}
            {bannerProjectId && <ProjectPublishedBanner projectId={bannerProjectId} />}

            {/* Контент под общей шапкой: split → две колонки со своими скроллами; narrow →
                общий вертикальный скролл (шапка+плашка закреплены сверху). Drag&drop файла —
                на уровне видимой коробки окна (DrawerShell). */}
            <div
              className={cn(
                'relative flex min-h-0 flex-1',
                isSplit ? 'overflow-hidden' : 'flex-col overflow-y-auto overscroll-contain',
              )}
            >
              {/* narrow: sticky-заголовок — первый ребёнок общего скролл-контейнера. */}
              {!isSplit && stickyTitleBar}
              {/* === ЛЕВАЯ КОЛОНКА (задача) === В split — своя скроллящаяся колонка;
                  narrow — натуральная высота внутри общего скролла, снизу бордер до комментов.
                  bg-background/95 (без backdrop-blur — иначе колонка становится containing-block
                  для position:fixed и плавающее меню форматирования зажимается). */}
              <div
                className={cn(
                  'bg-background/95',
                  isSplit
                    ? 'min-w-0 flex-1 overflow-y-auto overscroll-contain'
                    : 'shrink-0 border-b',
                )}
              >
                {/* split: sticky-заголовок живёт в левой колонке (у неё свой скролл). */}
                {isSplit && stickyTitleBar}

              {/* === ОБЛОЖКА + ИКОНКА === Над заголовком (Notion-style). Обложка во всю ширину,
                  иконка/кнопки «Добавить …» с тем же боковым отступом, что и заголовок. */}
              <TaskHeaderMedia
                key={`media-${task.id}`}
                taskId={task.id}
                icon={task.icon}
                cover={task.cover}
                coverPosition={task.coverPosition}
                canEdit={canEdit}
                onSave={saveMedia}
                hovered={topZoneHover}
                onHoverChange={(enter) => (enter ? enterTopZone() : leaveTopZone())}
              />

              {/* === ОПИСАНИЕ === Заголовок и описание ОДНИМ полем сверху (1-я строка —
                  по сути заголовок). Полное editDescription редактируется напрямую,
                  сохраняется по blur / Ctrl+Cmd+Enter. Работает в любом статусе. */}
              <div ref={bodyContainerRef} className="px-[var(--pf-drawer-px)] pb-1 pt-0">
                <TaskBodyEditor
                  key={`desc-${task.id}`}
                  editorRef={bodyEditorRef}
                  onUploadImage={uploadImageInline}
                  onImageRemoved={handleInlineImageRemoved}
                  body={editDescription}
                  onBodyChange={handleDescriptionChange}
                  onCommit={() => void commitDescription(editDescription)}
                  // Догрузилась инлайн-картинка → сохраняем СРАЗУ (переданный markdown уже
                  // содержит фигуру): переживает reload, аттач не «осиротеет» в «Файлы».
                  onImageUploaded={(md) => void commitDescription(md)}
                  onPasteFiles={(files) => void uploadFilesDirectly(files)}
                  disabled={editSaving}
                  placeholder="Название и описание…"
                />
              </div>
              {/* Sentinel — ПОСЛЕ заголовка/описания: закреплённый заголовок сверху появляется
                  ТОЛЬКО когда начало задачи (заголовок+описание) ушло вверх за пределы видимой
                  области (напр. при длинной ленте комментариев). Раньше «беговую дорожку» давали
                  панель+плашка внутри скролла; теперь они закреплены сверху, поэтому сентинел
                  ставим под заголовок. */}
              <div ref={titleSentinelRef} aria-hidden className="h-0" />

              {/* === ПЛЮСИКИ === Горизонтальный ряд add-кнопок (Notion «+Add»-style) прямо
                  под заголовком/описанием и НАД блоком свойств. Только поддерживаемые
                  действия: «+ Подзадача» (дописывает `- [ ]` в описание) и «+ Файл»
                  (открывает скрытый file-picker → uploadFilesDirectly). Переносятся
                  на узких экранах (flex-wrap, вплоть до 320px). */}
              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-[var(--pf-drawer-px)] pb-1 pt-0.5">
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
                      iconOnly
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
              <div className="px-[var(--pf-drawer-px)] pb-2.5 pt-1">
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
                        {/* «Перенести в проект» переехал в шапку — TaskProjectChip
                            (симметричная пара к статус-пилюле). */}
                      </div>
                    ),
                    deadline: (
                      <TaskDeadlineChip
                        task={task}
                        onChanged={() => notifyChanged()}
                        className={PROPERTY_VALUE_CLASS}
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
                          items={filesRowAttachments}
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
                <div ref={bodyRef} className={cn('px-4 py-5', isSplit && 'h-full overflow-y-auto', flashCls)}>
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
          </div>
        ) : (
          // === CREATE MODE === — окно создания = окно редактирования: заголовок +
          // плюсики + ряд свойств + тело, resizable + split (справа — плейсхолдер
          // пустых комментариев). Источник правды — единое `description`.
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {/* #3: верхняя панель + плашка — ОБЩАЯ ШАПКА НА ВСЮ ШИРИНУ (над обоими столбцами
                в split), поэтому плашка идёт через оба столбца. */}
            <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-background/95 px-3">
              {renderCloseButton()}
              {renderMaximizeButton()}
              <span className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {projectName ? `${projectName} · ` : ''}Новая задача
              </span>
            </div>
            {bannerProjectId && <ProjectPublishedBanner projectId={bannerProjectId} />}

            {/* Контент под общей шапкой: split → две колонки; narrow → стек. */}
            <div className={cn('flex min-h-0 flex-1', isSplit ? 'overflow-hidden' : 'flex-col')}>
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
                  className="pf-scroll-visible min-h-0 flex-1 overscroll-contain"
                >
                {/* «Восстановить» — если осталась незавершённая задача с прошлого закрытия
                    (текст, дедлайн, приоритет, режим, ответственный). Пропадает после создания. */}
                {showRestore && (
                  <div className="px-3 pt-1">
                    <button
                      type="button"
                      onClick={handleRestoreCreateDraft}
                      className="flex w-full items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                      title="Вернуть прошлую незавершённую задачу со всеми параметрами"
                    >
                      <RotateCcw className="size-3.5 shrink-0" />
                      Восстановить прошлую задачу
                    </button>
                  </div>
                )}

                {/* Заголовок и описание — ОДНИМ полем сверху (1-я строка = заголовок). */}
                <div ref={createBodyContainerRef} className="px-3 pb-1 pt-0">
                  <Suspense fallback={<div className="min-h-[6rem]" />}>
                    <RichTextEditor
                      ref={createEditorRef}
                      variant="description"
                      selectionMenu={false}
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
                      onUploadImage={uploadImageInline}
                      className="min-h-[6rem] text-sm leading-snug"
                    />
                  </Suspense>
                </div>

                {/* Плюсики: + Подзадача / + Файл. Справа — Копировать / AI (как в edit-mode;
                    Переработка/План тут нет — они требуют уже сохранённой задачи). */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pb-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                  <div className="flex shrink-0 items-center gap-0.5">
                    <CopyTaskButton description={description} />
                    <AiComposeDialog
                      text={description}
                      projectId={aiProjectId}
                      onImproved={setDescription}
                      onDistributed={() => onClose()}
                      ralphMode={createRalphMode}
                      disabled={saving}
                      iconOnly
                    />
                  </div>
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

                {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
              </form>

              {/* Футер: AI слева, Отмена/Создать справа. */}
              <div className="flex flex-col gap-2 border-t bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
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

