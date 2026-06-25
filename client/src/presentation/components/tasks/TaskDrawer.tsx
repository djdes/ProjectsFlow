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
import { ArrowRight, Bot, CalendarClock, ChevronDown, ChevronsRight, ChevronUp, Clock, Download, FileText, Flag, Loader2, Paperclip, Pencil, Plus, Send, Trash2, UserPlus, X } from 'lucide-react';
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
import { Markdown } from '@/presentation/components/markdown/Markdown';
import { toggleChecklistItem } from '@/lib/checklist';
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
import { DelegationBadge } from './DelegationBadge';
import { DeadlinePicker } from './DeadlinePicker';
import { PrioritySelect } from './PrioritySelect';
import { TaskPriorityChip } from './TaskPriorityChip';
import { TaskDeadlineChip } from './TaskDeadlineChip';
import { PropertyRow, EmptyValue, PROPERTY_VALUE_CLASS } from './PropertyRow';
import { CopyTaskButton } from './CopyTaskButton';
import { ReworkTaskButton } from './ReworkTaskButton';
import { PlanTaskButton } from './PlanTaskButton';
import { formatTaskCreated } from '@/lib/datetime';
import type { TaskPriority } from '@/domain/task/Task';
import { TaskDrawerComposer } from './TaskDrawerComposer';
import { TaskDrawerAttachmentRow } from './TaskDrawerAttachmentRow';
import { CancelWorkButton } from './CancelWorkButton';
import { STATUS_LABEL } from './statusLabels';
import { AiImproveButton } from '@/presentation/components/ai/AiImproveButton';
import { AiComposeDialog } from '@/presentation/components/ai/AiComposeDialog';
import type { MentionMember } from '@/presentation/components/editor/RichTextEditor';

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
  const [activeTab, setActiveTab] = useState<'discussion' | 'live'>('discussion');
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
    setActiveTab('discussion');
    setLiveRunning(false);
    setCommentCount(0);
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

  // «+ подзадача» (edit-mode): дописываем пустой checklist-пункт `- [ ]` в конец описания
  // и раскрываем описание, чтобы юзер сразу набрал текст пункта. Бэкенда для подзадач нет —
  // это markdown-чеклист внутри описания (тот же механизм, что toggleCheckbox в редакторе).
  const appendSubtask = async (): Promise<void> => {
    if (state?.mode !== 'edit') return;
    const { projectId, id } = state.task;
    const current = state.task.description ?? '';
    const sep = current.length === 0 ? '' : current.endsWith('\n') ? '' : '\n';
    const next = `${current}${sep}- [ ] `;
    try {
      await taskRepository.update(projectId, id, { description: next });
      onCommitsChange?.();
    } catch (e) {
      toast.error(`Не удалось добавить подзадачу: ${(e as Error).message}`);
    }
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

  const task = state?.mode === 'edit' ? state.task : null;
  const scrollToCommentId = state?.mode === 'edit' ? state.scrollToCommentId : undefined;
  const canEdit = !!task && task.status !== 'done';

  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showClose={false}
        className="grid h-dvh w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[900px]"
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
            {/* === STICKY HEADER === Notion-style. Единственный нижний бордер на всём
                контейнере шапки — это ЕДИНСТВЕННЫЙ разделитель между телом задачи и
                переключателем вкладок (никаких border-t у описания и border-b у вкладок). */}
            <div className="border-b bg-background/95 backdrop-blur-md">
              {/* Row A: контекст · короткий id (слева), действия (Копир./Переработка/План)
                  + передать/статус (справа). Дата создания переехала в ряд свойств «Создано». */}
              <div className="flex items-center gap-2 px-4 pt-3">
                {renderCloseButton()}
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
                {/* Группа действий: единый стиль (size-8, hover bg-hover). Видны для
                    релевантных статусов (Переработка/План — только пока задача правится). */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <CopyTaskButton description={task.description ?? ''} />
                  {canEdit && (
                    <>
                      <ReworkTaskButton projectId={task.projectId} taskId={task.id} />
                      <PlanTaskButton projectId={task.projectId} taskId={task.id} />
                    </>
                  )}
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
              </div>

              {/* Закреплённое описание (заголовок/тело задачи): всегда под рукой и всегда
                  редактируемо — TaskDescriptionEditor работает в ЛЮБОМ статусе, включая done
                  (клик по тексту = правка). Без собственного border-t — единственный
                  разделитель идёт ниже всей шапки. Описание всегда раскрыто. */}
              <div className="px-4 pb-1 pt-1">
                <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
                  <TaskDescriptionEditor
                    key={task.id}
                    projectId={task.projectId}
                    taskId={task.id}
                    initialDescription={task.description ?? ''}
                    onSaved={() => onCommitsChange?.()}
                    onPasteFiles={(files) => void uploadFilesDirectly(files)}
                  />
                </div>
              </div>

              {/* === ПЛЮСИКИ === Горизонтальный ряд add-кнопок (Notion «+Add»-style) прямо
                  под заголовком/описанием и НАД блоком свойств. Только поддерживаемые
                  действия: «+ Подзадача» (дописывает `- [ ]` в описание) и «+ Файл»
                  (открывает скрытый file-picker → uploadFilesDirectly). Переносятся
                  на узких экранах (flex-wrap, вплоть до 320px). */}
              {canEdit && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-0.5">
                  <button
                    type="button"
                    onClick={() => void appendSubtask()}
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
              )}

              {/* === PROPERTIES === Notion-style вертикальные строки свойств. Рендерятся
                  ВСЕГДА (для любого статуса, включая done) — строка не прячется по статусу;
                  если контрол неправим для done — показываем значение, контрол disabled. */}
              <div className="px-3 pb-2.5 pt-1">
                {/* Ответственный — делегирование. Показываем бейдж текущей делегации
                    (если есть) и/или кнопку «назначить»; для проектов без делегирования —
                    «Никто». Гейтим только ВОЗМОЖНОСТЬ делегировать, не саму строку. */}
                <PropertyRow icon={UserPlus} label="Ответственный">
                  <div className="flex min-h-7 flex-wrap items-center gap-1.5">
                    {task.delegation && currentUser?.id && (
                      <DelegationBadge delegation={task.delegation} currentUserId={currentUser.id} />
                    )}
                    {canEdit && (isInbox || isShared) ? (
                      <DelegateTaskButton
                        task={task}
                        currentUserId={currentUser?.id ?? null}
                        onChanged={() => onCommitsChange?.()}
                        projectId={isShared ? task.projectId : undefined}
                      />
                    ) : null}
                    {!task.delegation && !(canEdit && (isInbox || isShared)) && (
                      <EmptyValue>Никто</EmptyValue>
                    )}
                    {isInbox && canEdit && (
                      <AssignToProjectSelect
                        task={task}
                        onAssigned={() => {
                          onCommitsChange?.();
                          onClose();
                        }}
                      />
                    )}
                  </div>
                </PropertyRow>

                {/* Дедлайн — пикер inline; пустое значение читается как «Пусто». */}
                <PropertyRow icon={CalendarClock} label="Дедлайн">
                  <TaskDeadlineChip
                    task={task}
                    onChanged={() => onCommitsChange?.()}
                    className={PROPERTY_VALUE_CLASS}
                    emptyLabel="Пусто"
                    disabled={!canEdit}
                  />
                </PropertyRow>

                {/* Приоритет — пикер inline; пустое значение → «Без приоритета». */}
                <PropertyRow icon={Flag} label="Приоритет">
                  <TaskPriorityChip
                    task={task}
                    onChanged={() => onCommitsChange?.()}
                    className={PROPERTY_VALUE_CLASS}
                    disabled={!canEdit}
                  />
                </PropertyRow>

                {/* Режим воркера — селектор inline. */}
                <PropertyRow icon={Bot} label="Режим">
                  <TaskRalphModeChip
                    task={task}
                    onChanged={() => onCommitsChange?.()}
                    className={PROPERTY_VALUE_CLASS}
                    disabled={!canEdit}
                  />
                </PropertyRow>

                {/* Файлы — чипы вложений или «Пусто». Когда файлов нет — показываем
                    «Пусто» (загрузка — через add-affordance «+ Файл» в ряду плюсиков
                    над свойствами), чтобы не дублировать пустую кнопку-плейсхолдер. */}
                <PropertyRow icon={Paperclip} label="Файлы">
                  {headerAttachments.length > 0 ? (
                    <TaskDrawerAttachmentRow
                      items={headerAttachments}
                      canEdit={canEdit}
                      onAddFiles={(files) => {
                        void uploadFilesDirectly(files);
                      }}
                    />
                  ) : (
                    <span className="inline-flex min-h-7 items-center px-1.5">
                      <EmptyValue />
                    </span>
                  )}
                </PropertyRow>

                {/* Создано — read-only, приглушённо. */}
                <PropertyRow icon={Clock} label="Создано">
                  <span className="inline-flex min-h-7 items-center px-1.5 text-sm text-muted-foreground/70">
                    {formatTaskCreated(task.createdAt)}
                  </span>
                </PropertyRow>
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
              {/* Центрированный переключатель Обсуждение | LIVE. Без собственного border —
                  единственный разделитель идёт по нижнему краю шапки выше. Счётчик
                  комментариев свёрнут в триггер «Обсуждение · N». */}
              <div className="flex justify-center px-4 py-2">
                <TabsList className="h-8">
                  <TabsTrigger value="discussion" className="text-xs">
                    Обсуждение
                    {commentCount > 0 && (
                      <span className="ml-1 tabular-nums text-muted-foreground/70">
                        · {commentCount}
                      </span>
                    )}
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
                    onCountChange={setCommentCount}
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
                {renderCloseButton()}
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {projectName ? `${projectName} · ` : ''}Новая задача
                </span>
              </div>
            </div>
            <form
              ref={formRef}
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
                <Suspense fallback={<div className="min-h-[5.5rem]" />}>
                  <RichTextEditor
                    variant="description"
                    value={description}
                    onChange={setDescription}
                    onSubmit={() => {
                      // Ctrl/Cmd+Enter внутри редактора → сабмит формы создания задачи.
                      if (description.trim().length === 0) {
                        setError('Введите описание');
                        return;
                      }
                      formRef.current?.requestSubmit();
                    }}
                    placeholder="Что нужно сделать?"
                    autoFocus={!isCoarsePointer}
                    onPasteFiles={addPendingFiles}
                    className="min-h-[5.5rem] text-sm leading-snug"
                  />
                </Suspense>
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
  // Клик по AI открывает Radix-диалог, который перехватывает фокус → редактор получает
  // blur. Этот флаг (взводится на mousedown по AI) гасит blur-save, чтобы не было лишней
  // записи и преждевременного сворачивания: запись делает сам AI-flow.
  const aiOpeningRef = useRef(false);

  // Если родитель открыл другой task — синхронизируем initial внутрь.
  useEffect(() => {
    setDescription(initialDescription);
    setDraft(initialDescription);
    setEditing(false);
  }, [initialDescription, taskId]);

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

  // blur редактора → сохранить, КРОМЕ случая, когда фокус ушёл в открывшийся AI-диалог
  // (там своя запись). RichTextEditor сам уже не зовёт onBlur, когда фокус ушёл в его
  // floating-UI (bubble/slash/@-mention). aiOpeningRef гасит save при открытии AI-диалога.
  const handleEditorBlur = (): void => {
    if (aiOpeningRef.current) {
      aiOpeningRef.current = false;
      return;
    }
    void save();
  };

  // Esc внутри редактора → отмена правки (capture на обёртке, т.к. редактор Esc не отдаёт).
  const handleWrapperKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  // Клик по тексту → режим редактирования, КРОМЕ клика по ссылке или чекбоксу внутри
  // markdown (их обрабатываем по назначению). Контейнер — div, а не <button>: rendered
  // markdown содержит блочные элементы (<p>/<ul>/<pre>), невалидные внутри <button>.
  const handleDisplayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('a,input')) return;
    enterEdit();
  };
  const handleDisplayKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
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
          Копировать/Переработка/План переехали в группу действий шапки задачи; здесь
          остаётся только AI-контрол (всегда виден) + сворачивание. bg/blur — чтобы текст
          под кластером оставался читаемым. */}
      <div className="absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-md bg-background/85 px-0.5 backdrop-blur-sm">
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
        <div
          className="space-y-1"
          onKeyDownCapture={handleWrapperKeyDownCapture}
        >
          {/* WYSIWYG-редактор: padding/leading/шрифт 1-в-1 с display ниже, чтобы
              текст не «прыгал» при переключении. Сохранение — blur / Ctrl+Cmd+Enter. */}
          <Suspense
            fallback={
              <div className="max-h-[60vh] min-h-[1.75rem] py-1.5 text-sm leading-snug">{draft}</div>
            }
          >
            <RichTextEditor
              variant="description"
              value={draft}
              onChange={setDraft}
              onSubmit={() => void save()}
              onBlur={handleEditorBlur}
              autoFocus
              disabled={saving}
              onPasteFiles={onPasteFiles}
              className="max-h-[60vh] overflow-y-auto py-1.5 text-sm leading-snug"
            />
          </Suspense>
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
  // Сообщает текущее число комментариев — drawer сворачивает его в триггер «Обсуждение · N».
  onCountChange,
  // Deep-link: id комментария, к которому надо скроллнуть после загрузки (?task=X#comment-Y).
  scrollToCommentId,
}: {
  projectId: string;
  taskId: string;
  onCommentCreatedRef?: React.MutableRefObject<((c: TaskComment) => void) | null>;
  onFirstLoad?: () => void;
  onCountChange?: (count: number) => void;
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

