import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Download, FileText, Loader2, Map, Maximize2, Minimize2, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react';
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
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
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
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';
import { toggleChecklistItem } from '@/lib/checklist';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  useTextFieldFormatting,
  copyMarkdownForTelegram,
  TelegramCopyButton,
} from '@/presentation/hooks/useTextFieldFormatting';
import { useAutoGrowTextarea } from '@/presentation/hooks/useAutoGrowTextarea';
import { LiveTab } from './LiveTab';
import { ClaudeIcon } from './ClaudeIcon';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import {
  extractClipboardFiles,
  formatBytes,
  isImageMime,
} from '@/presentation/components/attachments/files';
import { RalphModeSelect } from './RalphMode';
import type { RalphMode, TaskStatus } from '@/domain/task/Task';
import { TASK_STATUSES } from '@/domain/task/Task';
import { DelegateSelect } from './DelegateSelect';
import { AssignToProjectSelect } from './AssignToProjectSelect';
import { DelegateTaskButton } from './DelegateTaskButton';
import { DeadlinePicker } from './DeadlinePicker';
import { PrioritySelect } from './PrioritySelect';
import { TaskPriorityChip } from './TaskPriorityChip';
import { TaskDeadlineChip } from './TaskDeadlineChip';
import type { TaskPriority } from '@/domain/task/Task';
import { TaskDrawerComposer } from './TaskDrawerComposer';
import { TaskDrawerAttachmentRow } from './TaskDrawerAttachmentRow';
import { CancelWorkButton } from './CancelWorkButton';
import { STATUS_LABEL } from './statusLabels';
import { AiImproveButton } from '@/presentation/components/ai/AiImproveButton';
import { AiComposeDialog } from '@/presentation/components/ai/AiComposeDialog';

type PendingFile = {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
};

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
};

// Chip-селектор режима Ralph в edit-mode шапки. Показывает текущий режим бейджем;
// клик раскрывает dropdown для смены — PATCH идёт сразу же (best-effort, error → toast).
function TaskRalphModeChip({
  task,
  onChanged,
}: {
  task: Task;
  onChanged: () => void;
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

  // Тихий чип в ряду свойств шапки — только иконка режима + каретка (без текста «Обычный»).
  return (
    <RalphModeSelect
      value={mode}
      onChange={(v) => void change(v)}
      disabled={saving}
      variant="ghost"
      iconOnly
      showCaret
      className="!h-7 w-auto gap-1 !px-1.5 !py-0 text-muted-foreground hover:text-foreground"
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
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors hover:ring-1 hover:ring-foreground/20 disabled:opacity-50',
            STATUS_BADGE_COLOR[status],
          )}
        >
          {STATUS_LABEL[status]}
          <ChevronDown className="size-3 opacity-60" />
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
}: Props): React.ReactElement {
  const { user: currentUser } = useCurrentUser();
  const { taskRepository, recordTaskView } = useContainer();
  const { animations } = useMotion();
  // Фиксируем «юзер открыл задачу» — единая точка для всех мест, где открывается drawer
  // (доска, «Поручено мне», блок «Недавнее»). Только edit-mode с реальной задачей; раз на
  // taskId. Fire-and-forget (ошибки глотаем), затем шлём 'pf:recent-changed' — блок
  // «Недавнее» в сайдбаре перефетчит без перезагрузки.
  const recordedTaskIdRef = useRef<string | null>(null);
  const openTaskId = state?.mode === 'edit' ? state.task.id : null;
  useEffect(() => {
    if (!openTaskId || recordedTaskIdRef.current === openTaskId) return;
    recordedTaskIdRef.current = openTaskId;
    void recordTaskView
      .execute(openTaskId)
      .then(() => window.dispatchEvent(new CustomEvent('pf:recent-changed')))
      .catch(() => {});
  }, [openTaskId, recordTaskView]);
  // В create-mode description редактируется обычной textarea на форме; в edit-mode
  // компонент TaskDescriptionEditor самостоятельно фетчит/сохраняет через taskRepository,
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
  // Drag-active флаг для create-mode (подсветка рамки при перетаскивании файлов).
  const [createDragActive, setCreateDragActive] = useState(false);
  // Ref на скрытый file input для кнопки «Вложение» в create-mode.
  const createFileInputRef = useRef<HTMLInputElement>(null);
  // Expand-toggle: false → drawer 640px; true → full-width. На mobile (pointer: coarse)
  // toggle всегда скрыт, drawer и так почти на весь экран (sheet.tsx default = w-3/4).
  const [expanded, setExpanded] = useState(false);
  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
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
  // Закреплённое описание в шапке: по умолчанию свёрнуто до 2 строк, клик раскрывает.
  const [descExpanded, setDescExpanded] = useState(false);
  // Активная вкладка тела edit-режима: «Обсуждение» (комментарии) | LIVE (лента воркера).
  const [activeTab, setActiveTab] = useState<'discussion' | 'live'>('discussion');
  // Есть ли running LIVE-сессия (бейдж 🔴 на триггере вкладки). LiveTab сообщает через колбэк.
  const [liveRunning, setLiveRunning] = useState(false);
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
  // autoFocus только на desktop — на мобильных клавиатура сразу перекрывает диалог.
  // descNodeRef — объектный ref для меню форматирования (хук читает .current).
  const descNodeRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useCallback((el: HTMLTextAreaElement | null) => {
    descNodeRef.current = el;
    if (el && !window.matchMedia('(pointer: coarse)').matches) el.focus();
  }, []);
  const createDescFmt = useTextFieldFormatting(descNodeRef);
  // Авто-рост поля описания новой задачи до 12 строк (site-wide правило).
  useAutoGrowTextarea(descNodeRef, description, { minRows: 4 });

  useEffect(() => {
    if (!state) return;
    setDescription(state.mode === 'edit' ? state.task.description ?? '' : '');
    setCreateRalphMode('normal');
    setCreateDelegateUserId(null);
    setCreateDeadline(null);
    setCreatePriority(null);
    setError(null);
    setExpanded(false);
    setDescExpanded(false);
    setActiveTab('discussion');
    setLiveRunning(false);
    setCreateDragActive(false);
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
      previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : '',
    }));
    setPendingFiles((prev) => [...prev, ...additions]);
  };

  // Direct upload for edit-mode paste (no AttachmentsSection in body anymore).
  const uploadFilesDirectly = async (files: File[]): Promise<void> => {
    if (state?.mode !== 'edit') return;
    const { projectId, id } = state.task;
    for (const file of files) {
      try {
        await taskRepository.uploadAttachment(projectId, id, file);
        toast.success(`${file.name} прикреплён`);
      } catch (err) {
        toast.error(`Не удалось загрузить ${file.name}: ${(err as Error).message}`);
      }
    }
    onCommitsChange?.();
    refetchHeaderAttachments();
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

  // Create-mode drag handlers (form-level, как в AddTaskDialog).
  const handleCreateDragOver = (e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setCreateDragActive(true);
  };
  const handleCreateDragLeave = (e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setCreateDragActive(false);
  };
  const handleCreateDrop = (e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setCreateDragActive(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addPendingFiles(Array.from(e.dataTransfer.files));
    }
  };

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
      // Если в create-режиме копились картинки — аплоадим их в новосозданную задачу.
      if (state?.mode === 'create' && pendingFiles.length > 0) {
        let ok = 0;
        for (const pf of pendingFiles) {
          try {
            await taskRepository.uploadAttachment(task.projectId, task.id, pf.file);
            ok += 1;
          } catch (err) {
            toast.error(`Не удалось загрузить ${pf.file.name}: ${(err as Error).message}`);
          }
        }
        if (ok > 0) {
          toast.success(
            ok === pendingFiles.length
              ? 'Картинки прикреплены'
              : `Прикреплено ${ok} из ${pendingFiles.length}`,
          );
          onCommitsChange?.();
        }
      }
      onClose();
    } catch (err) {
      setError((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const renderExpandButton = (): React.ReactElement | null => {
    if (isCoarsePointer) return null;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="group/exp size-8 shrink-0"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? 'Свернуть' : 'Развернуть'}
        title={expanded ? 'Свернуть' : 'Развернуть'}
      >
        {expanded ? (
          <Minimize2 className="size-4 transition-transform duration-150 group-hover/exp:scale-90" />
        ) : (
          <Maximize2 className="size-4 transition-transform duration-150 group-hover/exp:scale-110" />
        )}
      </Button>
    );
  };

  const renderCloseButton = (): React.ReactElement => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="group/x size-8 shrink-0"
      onClick={onClose}
      aria-label="Закрыть"
    >
      <X className="size-4 transition-transform duration-200 group-hover/x:rotate-90" />
    </Button>
  );

  const task = state?.mode === 'edit' ? state.task : null;
  const scrollToCommentId = state?.mode === 'edit' ? state.scrollToCommentId : undefined;
  const canEdit = !!task && task.status !== 'done';

  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showClose={false}
        className={cn(
          'grid h-dvh w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0',
          expanded ? 'sm:max-w-none' : 'sm:max-w-[640px]',
        )}
      >
        {/* a11y stub for Radix — visually hidden. */}
        <SheetTitle className="sr-only">
          {state?.mode === 'edit' ? 'Задача' : 'Новая задача'}
          {projectName ? ` · ${projectName}` : ''}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {state?.mode === 'edit' ? 'Редактирование задачи' : 'Создание новой задачи'}
        </SheetDescription>

        {state?.mode === 'edit' && task ? (
          <>
            {/* === STICKY HEADER === Notion-style: тонкий топ-бар (контекст · статус ·
                закрыть), под ним один спокойный ряд чипов-свойств одинаковой высоты.
                Аттачи (когда есть) переносятся на свою строку через basis-full. */}
            <div className="border-b bg-background/95 backdrop-blur-md">
              <div className="flex items-center gap-2 px-4 pt-3">
                {renderExpandButton()}
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
                {onMove && (
                  <TaskAdvanceButton
                    task={task}
                    onMove={onMove}
                    onChanged={() => onCommitsChange?.()}
                  />
                )}
                {onMove ? (
                  <TaskStatusChip
                    task={task}
                    onMove={onMove}
                    onChanged={() => onCommitsChange?.()}
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
                {renderCloseButton()}
              </div>

              {/* Порядок: Файл · Делегировать · Дедлайн · Приоритет · Режим (крайний справа). */}
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-4 pb-2.5 pt-1.5">
                <TaskDrawerAttachmentRow
                  items={headerAttachments}
                  canEdit={canEdit}
                  onAddFiles={(files) => {
                    void uploadFilesDirectly(files);
                  }}
                />
                {(isInbox || isShared) && (
                  <DelegateTaskButton
                    task={task}
                    currentUserId={currentUser?.id ?? null}
                    onChanged={() => onCommitsChange?.()}
                    projectId={isShared ? task.projectId : undefined}
                  />
                )}
                {isInbox && (
                  <AssignToProjectSelect
                    task={task}
                    onAssigned={() => {
                      onCommitsChange?.();
                      onClose();
                    }}
                  />
                )}
                <TaskDeadlineChip task={task} onChanged={() => onCommitsChange?.()} />
                <TaskPriorityChip task={task} onChanged={() => onCommitsChange?.()} />
                {(task.status === 'backlog' ||
                  task.status === 'todo' ||
                  task.status === 'awaiting_clarification') && (
                  <div className="ml-auto">
                    <TaskRalphModeChip task={task} onChanged={() => onCommitsChange?.()} />
                  </div>
                )}
              </div>

              {/* Закреплённое описание: всегда под рукой (тело скроллится к свежим
                  комментариям). Клик по свёрнутому превью раскрывает полный текст;
                  для не-done внутри — прежний inline-редактор (клик по тексту = правка). */}
              <div className="border-t border-border/60 px-4 py-2">
                {descExpanded ? (
                  <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
                    {canEdit ? (
                      <TaskDescriptionEditor
                        key={task.id}
                        projectId={task.projectId}
                        taskId={task.id}
                        initialDescription={task.description ?? ''}
                        onSaved={() => onCommitsChange?.()}
                        onCollapse={() => setDescExpanded(false)}
                        onPasteFiles={(files) => void uploadFilesDirectly(files)}
                      />
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="group/cu size-8 text-muted-foreground"
                            onClick={() => setDescExpanded(false)}
                            aria-label="Свернуть описание"
                          >
                            <ChevronUp className="size-4 transition-transform duration-150 group-hover/cu:-translate-y-0.5" />
                          </Button>
                        </div>
                        {task.description?.trim() ? (
                          <Markdown className="p-1">{task.description}</Markdown>
                        ) : (
                          <span className="text-sm italic text-muted-foreground">
                            Без описания
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDescExpanded(true)}
                    aria-expanded={false}
                    aria-label="Показать описание задачи"
                    className="group/desc -m-1 flex w-full items-start gap-2 rounded-md p-1 text-left transition-colors hover:bg-accent/60"
                  >
                    <div className="min-w-0 flex-1">
                      {task.description?.trim() ? (
                        <Markdown className={cn(MARKDOWN_COMPACT, 'line-clamp-2')}>
                          {task.description}
                        </Markdown>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">Без описания</span>
                      )}
                    </div>
                    <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover/desc:text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* === SCROLLABLE BODY — вкладки Обсуждение | LIVE === */}
            {/* Tabs занимает grid-строку minmax(0,1fr); каждая вкладка — свой scroll-контейнер.
                forceMount на обеих вкладках, чтобы LiveTab жил в фоне (бейдж 🔴 / live-стрим
                работают даже когда открыта «Обсуждение»). Неактивная скрыта через hidden. */}
            <Tabs
              value={activeTab}
              onValueChange={(v: string) => setActiveTab(v as 'discussion' | 'live')}
              className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
            >
              <div className="border-b px-4 pt-2">
                <TabsList className="h-8">
                  <TabsTrigger value="discussion" className="text-xs">
                    Обсуждение
                  </TabsTrigger>
                  <TabsTrigger value="live" className="text-xs">
                    LIVE
                    {liveRunning && (
                      <span
                        aria-hidden
                        className="size-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]"
                      />
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Обсуждение — существующее тело. bodyRef + scrollBodyToBottom живут ТОЛЬКО здесь. */}
              <TabsContent
                value="discussion"
                forceMount
                className="min-h-0 overflow-hidden data-[state=inactive]:hidden"
              >
                {/* Описание закреплено в шапке, коммиты скрыты — тело целиком отдано
                    обсуждению (Notion-style: комментарии и есть страница). */}
                <div ref={bodyRef} className="h-full overflow-y-auto px-4 py-5">
                  <TaskCommentsSection
                    projectId={task.projectId}
                    taskId={task.id}
                    onCommentCreatedRef={onCommentCreatedRef}
                    onFirstLoad={scrollBodyToBottom}
                    scrollToCommentId={scrollToCommentId}
                  />
                </div>
              </TabsContent>

              {/* LIVE — лента воркера. Свой scroll-контейнер внутри LiveTab. forceMount —
                  чтобы live-стрим/бейдж работали даже на скрытой вкладке. */}
              <TabsContent
                value="live"
                forceMount
                className="flex min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
              >
                <LiveTab
                  task={task}
                  attachments={headerAttachments}
                  active={activeTab === 'live'}
                  backlogTail={backlogTail}
                  todoTail={todoTail}
                  onRunningChange={setLiveRunning}
                  onCommentCreated={(c) => {
                    onCommentCreatedRef.current?.(c);
                    onCommitsChange?.();
                  }}
                  onTaskChanged={() => onCommitsChange?.()}
                />
              </TabsContent>
            </Tabs>

            {/* === STICKY FOOTER — композер только на вкладке «Обсуждение» === */}
            {activeTab === 'discussion' &&
              (task.status === 'in_progress' ? (
                <CancelWorkButton task={task} onChanged={() => onCommitsChange?.()} />
              ) : (
                // Один grid-ребёнок (строка 3): иначе на awaiting_clarification фрагмент
                // из двух элементов создаёт лишнюю неявную grid-строку и ломает раскладку
                // [header / body(1fr) / footer].
                <div>
                  {/* На awaiting_clarification — композер для ralph-answer'а + cancel над ним. */}
                  {task.status === 'awaiting_clarification' && (
                    <CancelWorkButton task={task} onChanged={() => onCommitsChange?.()} />
                  )}
                  <TaskDrawerComposer
                    task={task}
                    backlogTail={backlogTail}
                    todoTail={todoTail}
                    onCommentCreated={(c) => {
                      onCommentCreatedRef.current?.(c);
                      scrollBodyToBottom();
                      onCommitsChange?.();
                    }}
                    onTaskChanged={() => onCommitsChange?.()}
                  />
                </div>
              ))}
          </>
        ) : (
          // === CREATE MODE === — Todoist-style: textarea + chips сверху, pills под
          // полем, footer = RalphMode + AI + Cancel + Submit. Файлы — chips НАД textarea.
          <>
            <div className="border-b bg-background/95 px-4 pb-2 pt-4 backdrop-blur-md">
              <div className="flex items-center gap-2">
                {renderExpandButton()}
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {projectName ? `${projectName} · ` : ''}Новая задача
                </span>
                <div className="ml-auto">{renderCloseButton()}</div>
              </div>
            </div>
            <form
              id="task-drawer-form"
              onSubmit={handleSubmit}
              onPaste={handleFormPaste}
              onDragOver={handleCreateDragOver}
              onDragLeave={handleCreateDragLeave}
              onDrop={handleCreateDrop}
              className="space-y-3 overflow-y-auto px-4 pb-4 pt-4"
            >
              {/* Textarea с chips вложений сверху (как в AddTaskDialog / QuickAddTodo) */}
              <div
                className={cn(
                  'relative space-y-2 rounded-md border bg-background px-2 py-2 transition-colors',
                  createDragActive ? 'border-primary bg-primary/5' : 'border-input',
                )}
              >
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pendingFiles.map((pf) => (
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
                        <span className="max-w-[160px] truncate">{pf.file.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingFiles((prev) => {
                              const target = prev.find((p) => p.id === pf.id);
                              if (target) URL.revokeObjectURL(target.previewUrl);
                              return prev.filter((p) => p.id !== pf.id);
                            });
                          }}
                          className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive hover:text-white"
                          aria-label="Убрать"
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <ContextMenu onOpenChange={createDescFmt.onMenuOpenChange}>
                  <ContextMenuTrigger asChild>
                    <textarea
                      id="task-desc"
                      ref={descRef}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      onKeyDown={createDescFmt.keyDownHandler}
                      maxLength={50000}
                      rows={4}
                      placeholder="Что нужно сделать?"
                      className="block w-full resize-none bg-transparent text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none"
                    />
                  </ContextMenuTrigger>
                  {createDescFmt.menuContent}
                </ContextMenu>
              </div>

              {/* Иконки-свойства под полем (единый стиль с композерами доски):
                  скрепка, приоритет, дедлайн, делегат. Мягко всплывают при открытии
                  create-дравера — gated useMotion (reduced-motion → мгновенно). */}
              <motion.div
                initial={animations ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={animations ? { duration: 0.28, ease: 'easeOut', delay: 0.08 } : { duration: 0 }}
                className="flex flex-wrap items-center gap-1"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="group/at size-8 text-muted-foreground hover:text-foreground"
                  onClick={() => createFileInputRef.current?.click()}
                  disabled={saving}
                  aria-label="Вложение"
                  title="Вложение (или перетащи файл / Ctrl+V)"
                >
                  <Paperclip className="size-4 transition-transform duration-150 group-hover/at:-rotate-12 group-hover/at:scale-110" />
                </Button>
                <PrioritySelect
                  value={createPriority}
                  onChange={setCreatePriority}
                  disabled={saving}
                  iconOnly
                  className="size-8"
                />
                <DeadlinePicker
                  value={createDeadline}
                  onChange={setCreateDeadline}
                  disabled={saving}
                  iconOnly
                  className={cn('h-8', createDeadline === null ? 'w-8 px-0' : 'px-2')}
                />
                {(isInbox || isShared) && (
                  <DelegateSelect
                    value={createDelegateUserId}
                    onChange={setCreateDelegateUserId}
                    disabled={saving}
                    projectId={isShared && aiProjectId ? aiProjectId : undefined}
                    className="size-8"
                  />
                )}
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
              </motion.div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>

            {/* Footer: RalphMode + AI слева, Cancel + Submit справа */}
            <div className="flex flex-col gap-2 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                <RalphModeSelect
                  value={createRalphMode}
                  onChange={setCreateRalphMode}
                  disabled={saving}
                  variant="ghost"
                  iconOnly
                  className="!size-9 shrink-0 !p-0"
                />
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
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// =========================================================
// Inline-edit описания задачи. По дефолту — статичный текст; клик → textarea, autofocus,
// курсор в конец. Сохраняем на blur (если изменилось) или Ctrl/Cmd+Enter; Esc — отмена.
// =========================================================

function TaskDescriptionEditor({
  projectId,
  taskId,
  initialDescription,
  onSaved,
  onCollapse,
  onPasteFiles,
}: {
  projectId: string;
  taskId: string;
  initialDescription: string;
  onSaved: () => void;
  // Если задан — в шапке появляется кнопка «свернуть» (описание закреплено в header'е drawer'а).
  onCollapse?: () => void;
  // Вставка картинок из буфера (Ctrl+V) → прикрепляем к задаче через drawer.
  onPasteFiles?: (files: File[]) => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [description, setDescription] = useState(initialDescription);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fmt = useTextFieldFormatting(textareaRef);
  // Клик по AI открывает Radix-диалог, который перехватывает фокус → textarea получает
  // blur. Этот флаг (взводится на mousedown по AI) гасит blur-save, чтобы не было лишней
  // записи и преждевременного сворачивания: запись делает сам AI-flow.
  const aiOpeningRef = useRef(false);

  // Если родитель открыл другой task — синхронизируем initial внутрь.
  useEffect(() => {
    setDescription(initialDescription);
    setDraft(initialDescription);
    setEditing(false);
  }, [initialDescription, taskId]);

  // Авто-высота: поле ровно по содержимому (без пустой «коробки»), но не выше 60vh —
  // длинное описание скроллится внутри поля, а не распирает весь дровер.
  const autosize = useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const sh = el.scrollHeight;
    if (sh === 0) return; // скрытое поддерево (display:none) — не схлопываем в 0
    const max = Math.round(window.innerHeight * 0.6);
    el.style.height = `${Math.min(sh, max)}px`;
    el.style.overflowY = sh > max ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      // Курсор в конец — стандартный UX «продолжить писать».
      el.setSelectionRange(el.value.length, el.value.length);
      autosize();
    }
  }, [editing, autosize]);

  // Подгоняем высоту, когда draft меняется извне (например, AI подставил текст).
  useEffect(() => {
    if (editing) autosize();
  }, [draft, editing, autosize]);

  const enterEdit = (): void => {
    setDraft(description);
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      toast.error('Описание не может быть пустым');
      setDraft(description);
      setEditing(false);
      return;
    }
    if (trimmed === description.trim()) {
      // Изменений нет — просто свернуться.
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await taskRepository.update(projectId, taskId, { description: trimmed });
      setDescription(updated.description ?? '');
      setDraft(updated.description ?? '');
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // AI «Применить» (одно поле) → сразу пишем в задачу (без ручного Ctrl+Enter).
  const applyAndSave = async (next: string): Promise<void> => {
    const trimmed = next.trim();
    if (trimmed.length === 0) return;
    if (trimmed === description.trim()) {
      // AI вернул то же самое — не дёргаем сервер, просто свернёмся.
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await taskRepository.update(projectId, taskId, { description: trimmed });
      setDescription(updated.description ?? '');
      setDraft(updated.description ?? '');
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(`Не удалось сохранить: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const cancel = (): void => {
    setDraft(description);
    setEditing(false);
  };

  // Интерактивный чеклист в режиме просмотра: клик по чекбоксу переключает пункт
  // и сразу PATCH'ит описание (оптимистично, откат при ошибке).
  const toggleCheckbox = (index: number, checked: boolean): void => {
    const prev = description;
    const next = toggleChecklistItem(prev, index, checked);
    if (next === prev) return;
    setDescription(next);
    setDraft(next);
    void taskRepository
      .update(projectId, taskId, { description: next })
      .then(() => onSaved())
      .catch((e: unknown) => {
        setDescription(prev);
        setDraft(prev);
        toast.error(`Не удалось обновить чеклист: ${(e as Error).message}`);
      });
  };

  // Автосохранение при закрытии окна задачи. blur-save ловит клик мимо поля; этот unmount-хук —
  // страховка, когда дровер закрывают/переключают задачу (key={task.id} → remount), не сняв
  // фокус с textarea. Esc по-прежнему отменяет (cancel сбрасывает draft → editing=false → guard).
  // latest-ref обновляем в эффекте (нельзя писать ref во время рендера).
  const liveRef = useRef({ editing, saving, draft, description });
  useEffect(() => {
    liveRef.current = { editing, saving, draft, description };
  });
  useEffect(
    () => () => {
      const s = liveRef.current;
      const trimmed = s.draft.trim();
      if (!s.editing || s.saving || trimmed.length === 0 || trimmed === s.description.trim()) return;
      void taskRepository.update(projectId, taskId, { description: trimmed }).catch(() => undefined);
    },
    [taskRepository, projectId, taskId],
  );

  // blur textarea → сохранить, КРОМЕ случая, когда фокус ушёл в открывшийся AI-диалог
  // (там своя запись) ИЛИ в меню форматирования (его открытие уводит фокус — иначе редактор
  // схлопнулся бы до выбора пункта). aiOpeningRef/isMenuOpenRef — на случай пустого relatedTarget.
  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>): void => {
    const next = e.relatedTarget as HTMLElement | null;
    if (
      aiOpeningRef.current ||
      fmt.isMenuOpenRef.current ||
      (next && next.closest('[role="dialog"],[role="menu"]'))
    ) {
      aiOpeningRef.current = false;
      return;
    }
    void save();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  };

  // Ctrl+V с картинкой/файлом в буфере → прикрепляем к задаче (а не вставляем binary в текст).
  // Обычная текстовая вставка идёт по дефолту: extractClipboardFiles вернёт пусто.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!onPasteFiles) return;
    const files = extractClipboardFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    onPasteFiles(files);
  };

  // Клик по тексту → режим редактирования, КРОМЕ клика по ссылке или чекбоксу внутри
  // markdown (их обрабатываем по назначению). Контейнер — div, а не <button>: rendered
  // markdown содержит блочные элементы (<p>/<ul>/<pre>), невалидные внутри <button>.
  const handleDisplayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('a,input')) return;
    enterEdit();
  };
  const handleDisplayKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Enter/Space на ссылке/чекбоксе внутри markdown — их собственное действие, не edit.
    if ((e.target as HTMLElement).closest('a,input')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterEdit();
    }
  };

  return (
    <div className="relative">
      {/* Действия описания — поверх текста в правом верхнем углу, не занимают отдельную строку.
          AI-кнопка ВСЕГДА видна. bg/blur — чтобы текст под кластером оставался читаемым. */}
      <div className="absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-md bg-background/85 px-0.5 backdrop-blur-sm">
          {/* Копирует текущий текст описания с вёрсткой → вставка в Telegram применит формат.
              onMouseDown.preventDefault внутри кнопки не уводит фокус (без лишнего blur-save). */}
          {(editing ? draft : description).trim().length > 0 && (
            <TelegramCopyButton
              className="size-8"
              onCopy={() => copyMarkdownForTelegram(editing ? draft : description)}
            />
          )}
          {/* preventDefault — клик по AI не уводит фокус мгновенно; aiOpeningRef гасит
              blur-save, который иначе сработает, когда Radix-диалог перехватит фокус. */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              aiOpeningRef.current = true;
              // Подстраховка: если диалог не открылся (кнопка disabled) — снять флаг,
              // чтобы не подавить следующий настоящий blur.
              window.setTimeout(() => {
                aiOpeningRef.current = false;
              }, 300);
            }}
          >
            <AiComposeDialog
              text={editing ? draft : description}
              projectId={projectId}
              editTask={{ projectId, taskId }}
              onImproved={(next) => void applyAndSave(next)}
              onDistributed={() => onSaved()}
              disabled={saving}
              compact
            />
          </div>
          {/* «Составить план»: постит маркер ralph-plan-request. Ralph изучит репозиторий,
              пришлёт план на одобрение (Telegram/дашборд), затем воркер выполнит по плану. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-primary"
            disabled={saving}
            title="Составить план — Ralph изучит код и пришлёт план на одобрение"
            aria-label="Составить план"
            onClick={() => {
              void (async () => {
                try {
                  await taskRepository.createComment(
                    projectId,
                    taskId,
                    '🗺 Запрошен план реализации\n\n<!-- ralph-plan-request {"v":1} -->',
                    { mode: 'none' },
                  );
                  toast.success('План запрошен — Ralph составит и пришлёт на одобрение');
                } catch (e) {
                  toast.error(`Не удалось запросить план: ${(e as Error).message}`);
                }
              })();
            }}
          >
            <Map className="size-4" />
          </Button>
          {onCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={onCollapse}
              aria-label="Свернуть описание"
              title="Свернуть описание"
            >
              <ChevronUp className="size-4" />
            </Button>
          )}
      </div>

      {editing ? (
        <div className="space-y-1">
          {/* Безрамочное авто-растущее поле: padding/leading/шрифт 1-в-1 с display ниже,
              чтобы текст не «прыгал» при переключении. */}
          <ContextMenu onOpenChange={fmt.onMenuOpenChange}>
            <ContextMenuTrigger asChild>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={handleBlur}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  fmt.keyDownHandler(e);
                  if (!e.defaultPrevented) handleKeyDown(e);
                }}
                maxLength={50000}
                rows={1}
                disabled={saving}
                className="block max-h-[60vh] w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-0 py-1.5 text-sm leading-snug focus:outline-none disabled:opacity-50"
              />
            </ContextMenuTrigger>
            {fmt.menuContent}
          </ContextMenu>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={handleDisplayClick}
          onKeyDown={handleDisplayKeyDown}
          className="group w-full cursor-text rounded-md border border-dashed border-transparent px-0 py-1.5 text-left transition-colors hover:border-border hover:bg-muted/30"
          aria-label="Редактировать описание"
        >
          {description.trim().length > 0 ? (
            <Markdown onCheckboxToggle={toggleCheckbox}>{description}</Markdown>
          ) : (
            <span className="text-sm italic leading-snug text-muted-foreground">
              Нажми, чтобы добавить описание…
            </span>
          )}
        </div>
      )}
    </div>
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
  // Deep-link: id комментария, к которому надо скроллнуть после загрузки (?task=X#comment-Y).
  scrollToCommentId,
}: {
  projectId: string;
  taskId: string;
  onCommentCreatedRef?: React.MutableRefObject<((c: TaskComment) => void) | null>;
  onFirstLoad?: () => void;
  scrollToCommentId?: string;
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

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Комментарии</span>
        {!loading && comments.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground/60">{comments.length}</span>
        )}
      </div>

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
            />
          ))}
        </ul>
      ) : null}

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
// New-comment composer. Textarea + @-mention picker (popover с участниками команды).
// Триггер пикера — символ `@` на границе слова (старт строки, после пробела или \n).
// На select подставляет `@<DisplayName> `, server потом распарсит mention'ы и зарегает
// notification'ы для тех, кого зовут.
// =========================================================

type MentionState = {
  // Индекс символа `@` в textarea (включительно).
  start: number;
  // Текст после @ до курсора (может содержать пробелы — display name многоscлoвный).
  query: string;
};

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
  const [mention, setMention] = useState<MentionState | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fmt = useTextFieldFormatting(textareaRef);
  // Авто-рост поля комментария до 12 строк (site-wide правило).
  useAutoGrowTextarea(textareaRef, body, { minRows: 2 });

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
      prev.filter((p) => p.id === id).forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      return prev.filter((p) => p.id !== id);
    });
  };

  // Paste внутри composer'а: перехватываем файлы сюда (а не в аттачи задачи). stopPropagation
  // не даёт form-level paste-handler'у TaskDialog увести файл в аттачи задачи.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = extractClipboardFiles(e.clipboardData);
    e.stopPropagation();
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  // Кандидаты в пикере — кто угодно из команды кроме автора. Фильтруем по includes
  // (case-insensitive) — display name'ы могут содержать пробелы.
  const candidates = members
    .filter((m) => m.userId !== currentUser?.id)
    .filter((m) =>
      mention
        ? m.user.displayName.toLowerCase().includes(mention.query.toLowerCase())
        : true,
    );

  // Сбрасываем active-индекс при смене query.
  useEffect(() => {
    setPickerIndex(0);
  }, [mention?.query]);

  const detectMention = (text: string, cursor: number): MentionState | null => {
    const before = text.slice(0, cursor);
    const lastAt = before.lastIndexOf('@');
    if (lastAt === -1) return null;
    // @ должен стоять на границе слова — иначе email'ы (`user@gmail.com`) триггерили бы пикер.
    const charBefore = lastAt === 0 ? ' ' : before[lastAt - 1];
    if (charBefore !== ' ' && charBefore !== '\n' && charBefore !== '\t') return null;
    const query = before.slice(lastAt + 1);
    // Newline в query → пикер закрываем (юзер ушёл на новую строку).
    if (query.includes('\n')) return null;
    // Длинный query без матчей — нет смысла держать пикер открытым.
    if (query.length > 50) return null;
    return { start: lastAt, query };
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setBody(e.target.value);
    setMention(detectMention(e.target.value, e.target.selectionStart));
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const target = e.currentTarget;
    setMention(detectMention(body, target.selectionStart));
  };

  const insertMention = (member: ProjectMember): void => {
    if (!mention) return;
    const before = body.slice(0, mention.start);
    const after = body.slice(mention.start + 1 + mention.query.length);
    const insertion = `@${member.user.displayName} `;
    const newBody = before + insertion + after;
    setBody(newBody);
    setMention(null);
    // Возвращаем фокус и ставим курсор сразу после вставки.
    const newCursor = before.length + insertion.length;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      }
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
      setMention(null);
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      setPending([]);
    } catch (e) {
      toast.error(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mention && candidates.length > 0) {
      // Когда пикер открыт, перехватываем стрелки/Enter/Esc для навигации.
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPickerIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPickerIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = candidates[pickerIndex];
        if (selected) insertMention(selected);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    // Обычная отправка по Enter (без Shift).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const showPicker = mention !== null && candidates.length > 0;

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
        <ContextMenu onOpenChange={fmt.onMenuOpenChange}>
          <ContextMenuTrigger asChild>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={handleChange}
              onSelect={handleSelect}
              onKeyDown={(e) => {
                fmt.keyDownHandler(e);
                if (!e.defaultPrevented) handleKeyDown(e);
              }}
              onPaste={handlePaste}
              rows={2}
              disabled={submitting}
              placeholder="Комментарий…"
              className="block w-full resize-none rounded-md bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
            />
          </ContextMenuTrigger>
          {fmt.menuContent}
        </ContextMenu>
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

      {!preview && showPicker && (
        <MentionPicker
          candidates={candidates}
          activeIndex={pickerIndex}
          onSelect={insertMention}
          onHoverIndex={setPickerIndex}
        />
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

function MentionPicker({
  candidates,
  activeIndex,
  onSelect,
  onHoverIndex,
}: {
  candidates: readonly ProjectMember[];
  activeIndex: number;
  onSelect: (m: ProjectMember) => void;
  onHoverIndex: (i: number) => void;
}): React.ReactElement {
  return (
    <div className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-md border bg-popover shadow-md">
      <ul className="max-h-56 overflow-y-auto py-1 text-sm">
        {candidates.map((m, i) => (
          <li key={m.userId}>
            <button
              type="button"
              onClick={() => onSelect(m)}
              onMouseEnter={() => onHoverIndex(i)}
              // mousedown — чтобы клик не успел снять фокус с textarea до того, как
              // мы вставим mention (иначе textarea теряет selection и cursor-restore сломан).
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1.5 text-left',
                i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
              )}
            >
              <Avatar className="size-6 shrink-0">
                {m.user.avatarUrl ? (
                  <AvatarImage src={m.user.avatarUrl} alt={m.user.displayName} />
                ) : null}
                <AvatarFallback className="text-[10px]">
                  {getInitials(m.user.displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{m.user.displayName}</span>
            </button>
          </li>
        ))}
      </ul>
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
}): React.ReactElement {
  const { taskRepository } = useContainer();
  // Вопрос Ralph (F11) в этом комментарии → инлайн-кнопки ответа (как в CLI/Telegram).
  const ralphQuestion = parseRalphQuestion(comment.body);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fmt = useTextFieldFormatting(textareaRef);
  // Авто-рост поля правки комментария до 12 строк (site-wide правило).
  useAutoGrowTextarea(textareaRef, draft, { minRows: 2 });

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  };

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

  return (
    <li id={`comment-${comment.id}`} className="group flex scroll-mt-4 items-start gap-3">
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
        <div className="flex items-baseline gap-2">
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
          <div className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={enterEdit}
              aria-label="Редактировать"
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={() => void remove()}
              aria-label="Удалить"
            >
              <Trash2 className="size-3" />
            </Button>
            <CommentActionsMenu projectId={projectId} taskId={taskId} comment={comment} />
          </div>
        </div>
        {editing ? (
          <ContextMenu onOpenChange={fmt.onMenuOpenChange}>
            <ContextMenuTrigger asChild>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // blur-save, КРОМЕ ухода фокуса в меню форматирования (иначе правка
                // схлопнулась бы при открытии меню).
                onBlur={(e) => {
                  const next = e.relatedTarget as HTMLElement | null;
                  if (fmt.isMenuOpenRef.current || next?.closest('[role="menu"]')) return;
                  void save();
                }}
                onKeyDown={(e) => {
                  fmt.keyDownHandler(e);
                  if (!e.defaultPrevented) handleKeyDown(e);
                }}
                maxLength={10000}
                rows={2}
                disabled={saving}
                className="mt-0.5 block w-full resize-none bg-transparent p-0 text-sm leading-snug focus:outline-none disabled:opacity-50"
              />
            </ContextMenuTrigger>
            {fmt.menuContent}
          </ContextMenu>
        ) : (
          <div className="mt-0.5">
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
              isImageMime(att.mimeType) ? (
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

