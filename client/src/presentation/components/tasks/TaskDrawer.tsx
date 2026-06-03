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
import { ChevronDown, ChevronRight, Download, FileText, Loader2, Maximize2, Minimize2, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
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
import { TaskCommitsSection } from './TaskCommitsSection';
import { CommentBody } from './CommentBody';
import { Markdown } from '@/presentation/components/markdown/Markdown';
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
  // Показывать секцию коммитов в edit-режиме. Для inbox-проекта выключаем — у него
  // нет git-репо, привязывать нечего.
  showCommits?: boolean;
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

  // shadcn DropdownMenu — даёт нам же что и RalphModeSelect, но trigger компактный chip-вид.
  return (
    <RalphModeSelect
      value={mode}
      onChange={(v) => void change(v)}
      disabled={saving}
      className="!h-7 min-w-0 sm:min-w-[180px] !px-2 !py-0 text-xs"
    />
  );
}

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

  const statusBadgeColor: Record<TaskStatus, string> = {
    backlog: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    manual: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
    todo: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    in_progress: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    awaiting_clarification: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    done: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  };

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
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors hover:ring-1 hover:ring-foreground/20 disabled:opacity-50',
            statusBadgeColor[status],
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
                  statusBadgeColor[s],
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
  showCommits = true,
  projectName,
  backlogTail = null,
  todoTail = null,
  isInbox = false,
  isShared = false,
  aiProjectId = null,
  onMove,
}: Props): React.ReactElement {
  const { user: currentUser } = useCurrentUser();
  const { taskRepository } = useContainer();
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
  // Коммиты по умолчанию свёрнуты — это вторичный контент, чтобы не отвлекал.
  // Раскрытие — клик по заголовку.
  const [commitsOpen, setCommitsOpen] = useState(false);
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
  const descRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el && !window.matchMedia('(pointer: coarse)').matches) el.focus();
  }, []);

  useEffect(() => {
    if (!state) return;
    setDescription(state.mode === 'edit' ? state.task.description ?? '' : '');
    setCreateRalphMode('normal');
    setCreateDelegateUserId(null);
    setCreateDeadline(null);
    setCreatePriority(null);
    setError(null);
    setExpanded(false);
    setCommitsOpen(false);
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

  // Mapping статусов в цвет бейджа в header'е drawer'а.
  const statusBadgeColor: Record<Task['status'], string> = {
    backlog: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    manual: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
    todo: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    in_progress: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    awaiting_clarification: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    done: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  };

  const renderExpandButton = (): React.ReactElement | null => {
    if (isCoarsePointer) return null;
    return (
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
    );
  };

  const renderCloseButton = (): React.ReactElement => (
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
  );

  const task = state?.mode === 'edit' ? state.task : null;
  const scrollToCommentId = state?.mode === 'edit' ? state.scrollToCommentId : undefined;
  const canEdit = !!task && task.status !== 'done';

  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
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
            {/* === STICKY HEADER === */}
            <div className="border-b bg-background/95 backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3">
                {renderExpandButton()}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {projectName && (
                    <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {projectName}
                    </span>
                  )}
                  <span className="font-mono text-[10px] opacity-50">[{taskShortId(task.id)}]</span>
                </div>
                {onMove ? (
                  <TaskStatusChip
                    task={task}
                    onMove={onMove}
                    onChanged={() => onCommitsChange?.()}
                  />
                ) : (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                      statusBadgeColor[task.status],
                    )}
                  >
                    {STATUS_LABEL[task.status]}
                  </span>
                )}
                {(task.status === 'backlog' ||
                  task.status === 'todo' ||
                  task.status === 'awaiting_clarification') && (
                  <TaskRalphModeChip task={task} onChanged={() => onCommitsChange?.()} />
                )}
                <TaskPriorityChip task={task} onChanged={() => onCommitsChange?.()} />
                <TaskDeadlineChip task={task} onChanged={() => onCommitsChange?.()} />
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
                {renderCloseButton()}
              </div>

              <div className="px-4 py-2">
                <TaskDrawerAttachmentRow
                  items={headerAttachments}
                  canEdit={canEdit}
                  onAddFiles={(files) => {
                    void uploadFilesDirectly(files);
                  }}
                />
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
              <div className="border-b px-4 pt-2 sm:px-6">
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
                <div ref={bodyRef} className="h-full space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
                  {canEdit ? (
                    <TaskDescriptionEditor
                      key={task.id}
                      projectId={task.projectId}
                      taskId={task.id}
                      initialDescription={task.description ?? ''}
                      onSaved={() => onCommitsChange?.()}
                    />
                  ) : (
                    <div className="rounded-md border border-dashed border-transparent p-2 text-sm leading-snug">
                      {task.description?.trim() ? (
                        <Markdown>{task.description}</Markdown>
                      ) : (
                        <span className="italic text-muted-foreground">Без описания</span>
                      )}
                    </div>
                  )}

                  {showCommits && (
                    <div className="border-t pt-4">
                      <button
                        type="button"
                        onClick={() => setCommitsOpen((v) => !v)}
                        className="flex w-full items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground/70 hover:text-foreground"
                        aria-expanded={commitsOpen}
                      >
                        <ChevronRight
                          className={cn(
                            'size-3.5 shrink-0 transition-transform',
                            commitsOpen && 'rotate-90',
                          )}
                        />
                        <span>Коммиты</span>
                        {task.commitCount !== undefined && task.commitCount > 0 && (
                          <span className="text-[10px] opacity-70">· {task.commitCount}</span>
                        )}
                      </button>
                      {commitsOpen && (
                        <div className="mt-3">
                          <TaskCommitsSection task={task} onChange={() => onCommitsChange?.()} />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="border-t pt-4">
                    <TaskCommentsSection
                      projectId={task.projectId}
                      taskId={task.id}
                      onCommentCreatedRef={onCommentCreatedRef}
                      onFirstLoad={scrollBodyToBottom}
                      scrollToCommentId={scrollToCommentId}
                    />
                  </div>
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
            <div className="border-b bg-background/95 px-4 pb-2 pt-4 sm:px-6 backdrop-blur-md">
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
              className="space-y-3 overflow-y-auto px-4 pb-4 pt-4 sm:px-6"
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
                <textarea
                  id="task-desc"
                  ref={descRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={50000}
                  rows={4}
                  placeholder="Что нужно сделать. Контекст, шаги, ссылки. Ctrl+V — картинка пойдёт в аттачи."
                  className="block w-full resize-none bg-transparent text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none"
                />
              </div>

              {/* Пилюли-кнопки под полем: Priority, Deadline, Delegate, Вложение */}
              <div className="flex flex-wrap items-center gap-1.5">
                <PrioritySelect value={createPriority} onChange={setCreatePriority} disabled={saving} compact />
                <DeadlinePicker value={createDeadline} onChange={setCreateDeadline} disabled={saving} />
                {(isInbox || isShared) && (
                  <DelegateSelect
                    value={createDelegateUserId}
                    onChange={setCreateDelegateUserId}
                    disabled={saving}
                    projectId={isShared && aiProjectId ? aiProjectId : undefined}
                    className="h-7 w-7"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => createFileInputRef.current?.click()}
                  disabled={saving}
                  title="Вложение (или перетащи файл / Ctrl+V)"
                >
                  <Paperclip className="size-3.5" />
                  Вложение
                </Button>
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

              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>

            {/* Footer: RalphMode + AI слева, Cancel + Submit справа */}
            <div className="flex flex-col gap-2 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex flex-wrap items-center gap-1.5">
                <RalphModeSelect
                  value={createRalphMode}
                  onChange={setCreateRalphMode}
                  disabled={saving}
                  className="!h-7 min-w-[100px] !px-2 text-xs sm:!h-8 sm:min-w-[140px]"
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
}: {
  projectId: string;
  taskId: string;
  initialDescription: string;
  onSaved: () => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [description, setDescription] = useState(initialDescription);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Если родитель открыл другой task — синхронизируем initial внутрь.
  useEffect(() => {
    setDescription(initialDescription);
    setDraft(initialDescription);
    setEditing(false);
  }, [initialDescription, taskId]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      // Курсор в конец — стандартный UX «продолжить писать».
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

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

  const cancel = (): void => {
    setDraft(description);
    setEditing(false);
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

  if (editing) {
    return (
      <div className="space-y-1">
        {/* Сетка из border+padding+leading должна 1-в-1 совпадать с display-режимом ниже,
            иначе текст «прыгает» вверх/вниз при переключении. */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={handleKeyDown}
          maxLength={50000}
          rows={6}
          disabled={saving}
          className="block w-full resize-none rounded-md border border-transparent bg-transparent p-2 text-sm leading-snug focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground">
            Ctrl+Enter — сохранить, Esc — отменить. {saving && '…'}
          </p>
          {/* onMouseDown preventDefault не даёт blur сработать на textarea (и не сохранит
              черновик раньше времени), пока AI работает над текстом. */}
          <div className="ml-auto" onMouseDown={(e) => e.preventDefault()}>
            <AiImproveButton
              text={draft}
              projectId={projectId}
              onImproved={setDraft}
              disabled={saving}
              compact
            />
          </div>
        </div>
      </div>
    );
  }

  // Клик по тексту → режим редактирования, КРОМЕ клика по ссылке внутри markdown
  // (ссылку открываем, а не уходим в edit). Контейнер — div, а не <button>: rendered
  // markdown содержит блочные элементы (<p>/<ul>/<pre>), невалидные внутри <button>.
  const handleDisplayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('a')) return;
    enterEdit();
  };
  const handleDisplayKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterEdit();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleDisplayClick}
      onKeyDown={handleDisplayKeyDown}
      className={cn(
        // p-2 + border 1px — те же что у textarea выше, чтобы текст не «прыгал» при переключении.
        'group flex w-full cursor-text items-start gap-2 rounded-md border border-dashed border-transparent p-2 text-left transition-colors hover:border-border hover:bg-muted/30',
      )}
      aria-label="Редактировать описание"
    >
      {description.trim().length > 0 ? (
        <Markdown className="min-w-0 flex-1">{description}</Markdown>
      ) : (
        <span className="min-w-0 flex-1 text-sm italic leading-snug text-muted-foreground">
          Нажми, чтобы добавить описание…
        </span>
      )}
      <Pencil
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
      />
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Комментарии</Label>
        {!loading && comments.length > 0 && (
          <span className="text-xs text-muted-foreground">{comments.length}</span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-md bg-muted" />
          <div className="h-12 animate-pulse rounded-md bg-muted" />
        </div>
      ) : comments.length > 0 ? (
        <ul className="space-y-2">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              projectId={projectId}
              taskId={taskId}
              comment={c}
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
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={2}
          disabled={submitting}
          placeholder="Написать комментарий… Markdown, файлы (Ctrl+V)"
          className="block w-full resize-none rounded-md bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
        />
      )}
      <div className="absolute right-1.5 top-1.5 flex gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting}
          aria-label="Прикрепить файл"
        >
          <Paperclip className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => void submit()}
          disabled={submitting || (body.trim().length === 0 && pending.length === 0)}
          aria-label="Отправить"
        >
          {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
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

// Маппинг agent_name → читаемый title. Default — диспетчер (исторически 99% автокомментов).
// Расширяется без deploy backend'а — новые worker'ы добавлять сюда.
function agentTitle(agentName: string | null): string {
  switch (agentName) {
    case 'ralph-worker':
      return 'Воркер · Claude Opus 4.7';
    case 'ralph-grillme':
      return 'Grillme-агент · Claude Opus 4.7';
    case 'ralph-verify':
      return 'Верификатор · Claude Sonnet 4.6';
    case 'ralph-dispatcher':
    case null:
      return 'Диспетчер · Claude Code/Opus';
    default:
      // Forward-compat: незнакомое имя — generic с показом raw-имени.
      return `Агент · ${agentName}`;
  }
}

function CommentItem({
  projectId,
  taskId,
  comment,
  onUpdated,
  onDeleted,
}: {
  projectId: string;
  taskId: string;
  comment: TaskComment;
  onUpdated: (updated: TaskComment) => void;
  onDeleted: (id: string) => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  // Single-tenant: автор комментария — всегда текущий юзер (см. MEMORY: 1 user = 1 tenant).
  // Если когда-нибудь появится multi-tenancy, нужно резолвить юзера по comment.ownerUserId.
  const { user } = useCurrentUser();
  const isAgent = comment.actorKind === 'agent';
  const isSystem = comment.actorKind === 'system';
  const displayName = user?.displayName ?? '—';
  const initials = getInitials(displayName);

  return (
    <li id={`comment-${comment.id}`} className="group flex scroll-mt-4 items-start gap-2.5 py-1">
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
          {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={displayName} /> : null}
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
      )}
      <div className={`min-w-0 flex-1 ${isAgent ? 'pf-claude-agent' : ''}`}>
        <div className="flex items-baseline gap-2">
          {isAgent ? (
            <span className="pf-claude-agent-title truncate">
              {agentTitle(comment.agentName)}
            </span>
          ) : isSystem ? (
            <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              ⚙ Система
            </span>
          ) : (
            <span className="truncate text-xs font-medium">{displayName}</span>
          )}
          <span className="text-[11px] text-muted-foreground">
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
              className="size-6 text-destructive hover:text-destructive"
              onClick={() => void remove()}
              aria-label="Удалить"
            >
              <Trash2 className="size-3" />
            </Button>
            <CommentActionsMenu projectId={projectId} taskId={taskId} comment={comment} />
          </div>
        </div>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={handleKeyDown}
            maxLength={10000}
            rows={2}
            disabled={saving}
            className="mt-0.5 block w-full resize-none bg-transparent p-0 text-sm leading-snug focus:outline-none disabled:opacity-50"
          />
        ) : (
          <div className="mt-0.5">
            <CommentBody body={comment.body} />
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

