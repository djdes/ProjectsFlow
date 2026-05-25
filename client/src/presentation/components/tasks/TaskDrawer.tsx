import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { Download, FileText, Loader2, Maximize2, Minimize2, Paperclip, Pencil, Send, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Task } from '@/domain/task/Task';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { TaskComment } from '@/domain/task/TaskComment';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { getInitials } from '@/presentation/layout/projectIcons';
import { TaskCommitsSection } from './TaskCommitsSection';
import { CommentBody } from './CommentBody';
import { ClaudeIcon } from './ClaudeIcon';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import {
  extractClipboardFiles,
  formatBytes,
  isImageMime,
} from '@/presentation/components/attachments/files';
import { RalphModeSelect } from './RalphMode';
import type { RalphMode } from '@/domain/task/Task';

export type TaskDrawerState =
  | { mode: 'create'; status: Task['status'] }
  | { mode: 'edit'; task: Task };

type Props = {
  state: TaskDrawerState | null;
  onClose: () => void;
  // Возвращает созданный/обновлённый task — нужен в create-режиме, чтобы зааплоадить
  // pending-аттачи после получения task.id.
  // ralphMode — режим работы Ralph, который пользователь выбрал в форме (см. RalphModeSelect).
  // Передаётся только в create-mode; в edit-mode смена режима идёт через отдельный PATCH.
  onSubmit: (input: { description: string; ralphMode?: import('@/domain/task/Task').RalphMode }) => Promise<Task>;
  // Колбэк когда коммиты или аттачи у задачи поменялись — board перефетчит badge'и.
  onCommitsChange?: () => void;
  // Показывать секцию коммитов в edit-режиме. Для inbox-проекта выключаем — у него
  // нет git-репо, привязывать нечего.
  showCommits?: boolean;
  // Имя проекта — рисуем в шапке диалога как контекстный заголовок. В inbox не передаём.
  projectName?: string;
};

// Превью-тайл вложения в сетке: картинка → thumbnail, иначе → иконка + имя файла.
function AttachmentThumb({ url, name, mime }: { url?: string; name: string; mime: string }): React.ReactElement {
  if (isImageMime(mime) && url) {
    return <img src={url} alt={name} loading="lazy" className="size-full object-cover" />;
  }
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 p-1.5 text-center">
      <FileText className="size-6 text-muted-foreground" />
      <span className="line-clamp-2 break-all text-[10px] leading-tight text-muted-foreground">
        {name}
      </span>
    </div>
  );
}

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
      className="!h-7 min-w-[180px] !px-2 !py-0 text-xs"
    />
  );
}

export function TaskDrawer({
  state,
  onClose,
  onSubmit,
  onCommitsChange,
  showCommits = true,
  projectName,
}: Props): React.ReactElement {
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
  // В edit-режиме секция аттачей экспонирует addFiles через ref — чтобы paste-handler
  // на форме (поймает Ctrl+V даже когда фокус в textarea) мог пнуть аплоад.
  const attachmentsRef = useRef<AttachmentsHandle>(null);
  // Expand-toggle: false → drawer 640px; true → full-width. На mobile (pointer: coarse)
  // toggle всегда скрыт, drawer и так почти на весь экран (sheet.tsx default = w-3/4).
  const [expanded, setExpanded] = useState(false);
  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  // autoFocus только на desktop — на мобильных клавиатура сразу перекрывает диалог.
  const descRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el && !window.matchMedia('(pointer: coarse)').matches) el.focus();
  }, []);

  useEffect(() => {
    if (!state) return;
    setDescription(state.mode === 'edit' ? state.task.description ?? '' : '');
    setCreateRalphMode('normal');
    setError(null);
    setExpanded(false);
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
      void attachmentsRef.current?.addFiles(files);
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

  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Side-drawer справа: header/body/footer на grid'е, скролл в body.
          Mobile (pointer: coarse): drawer почти на всю ширину — sheet.tsx по умолчанию даёт w-3/4.
          Desktop: фикс max-w-[640px] (см. Task 6 — expand-toggle).  */}
      <SheetContent
        side="right"
        className={cn(
          'grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0',
          expanded ? 'w-screen sm:max-w-none' : 'sm:max-w-[640px]',
        )}
      >
        <SheetHeader className="px-6 pb-2 pt-4">
          {/* Title/Description обязаны существовать для a11y (Radix), но визуально не нужны.
              Видимый контент шапки — название проекта (контекст «к какому проекту таска»). */}
          <SheetTitle className="sr-only">
            {state?.mode === 'edit' ? 'Задача' : 'Новая задача'}
            {projectName ? ` · ${projectName}` : ''}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {state?.mode === 'edit' ? 'Редактирование задачи' : 'Создание новой задачи'}
          </SheetDescription>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
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
              {projectName ? (
                <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {projectName}
                </span>
              ) : null}
            </div>
            {/* Бейдж режима в edit-mode — компактный, кликабельный для смены. */}
            {state?.mode === 'edit' && (
              <TaskRalphModeChip
                task={state.task}
                onChanged={() => onCommitsChange?.()}
              />
            )}
          </div>
        </SheetHeader>

        <form
          id="task-drawer-form"
          onSubmit={handleSubmit}
          onPaste={handleFormPaste}
          className="space-y-4 overflow-y-auto px-6 pb-4"
        >
          {state?.mode === 'edit' ? (
            <TaskDescriptionEditor
              key={state.task.id}
              projectId={state.task.projectId}
              taskId={state.task.id}
              initialDescription={state.task.description ?? ''}
              onSaved={() => onCommitsChange?.()}
            />
          ) : (
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
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {state?.mode === 'edit' ? (
            <>
              <AttachmentsSection
                ref={attachmentsRef}
                projectId={state.task.projectId}
                taskId={state.task.id}
                onChange={() => onCommitsChange?.()}
              />
              <div className="border-t pt-4">
                <TaskCommentsSection projectId={state.task.projectId} taskId={state.task.id} />
              </div>
              {showCommits && (
                <div className="border-t pt-4">
                  <TaskCommitsSection task={state.task} onChange={() => onCommitsChange?.()} />
                </div>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-4">
          {state?.mode === 'edit' ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" form="task-drawer-form" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Создать
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// =========================================================
// Pending-attachments — выбор файлов ДО создания задачи. Состояние и валидация
// живут в TaskDialog (нужно зашерить с form-level paste-handler'ом); секция — чисто
// презентационная: drag-drop + file-picker + рендер превью.
// =========================================================

type PendingFile = {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
};

function PendingAttachmentsSection({
  files,
  onAdd,
  onRemove,
}: {
  files: PendingFile[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}): React.ReactElement {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      onAdd(Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div className="space-y-2" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div className="flex items-center justify-between">
        <Label>Файлы и&nbsp;картинки</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-3.5" />
          Прикрепить
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onAdd(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
      </div>

      <div
        className={`grid grid-cols-3 gap-2 rounded-md border-2 border-dashed p-2 transition-colors ${
          dragActive ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        {files.map((pf) => (
          <div
            key={pf.id}
            className="group relative aspect-square overflow-hidden rounded border bg-muted"
          >
            <AttachmentThumb url={pf.previewUrl || undefined} name={pf.file.name} mime={pf.file.type} />
            <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
              <p className="w-full truncate px-1.5 pb-1 text-left text-[10px] text-white">
                {pf.file.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(pf.id)}
              className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
              aria-label="Убрать"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
        {files.length === 0 && (
          <div className="col-span-3 grid place-items-center py-6 text-center text-xs text-muted-foreground">
            Перетащи файлы сюда, вставь из&nbsp;буфера (Ctrl+V) или нажми «Прикрепить».
            Они загрузятся после создания задачи.
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================
// Attachments — список + загрузка для уже существующей задачи. ExposeFiles
// через ref: form-level paste-handler в TaskDialog зовёт addFiles(files) когда
// пользователь жмёт Ctrl+V где-то на форме (включая фокус в textarea).
// =========================================================

type AttachmentsHandle = {
  addFiles: (files: FileList | File[]) => Promise<void>;
};

function AttachmentsSection({
  ref,
  projectId,
  taskId,
  onChange,
}: {
  ref?: Ref<AttachmentsHandle>;
  projectId: string;
  taskId: string;
  onChange: () => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [items, setItems] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    taskRepository
      .listAttachments(projectId, taskId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Не удалось загрузить аттачи: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, taskRepository]);

  const uploadFiles = async (files: FileList | File[]): Promise<void> => {
    const valid = Array.from(files);
    if (valid.length === 0) return;
    setUploadingCount((c) => c + valid.length);
    for (const file of valid) {
      try {
        const att = await taskRepository.uploadAttachment(projectId, taskId, file);
        setItems((prev) => [...prev, att]);
        onChange();
      } catch (e) {
        toast.error(`Не удалось загрузить ${file.name}: ${(e as Error).message}`);
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }
  };

  useImperativeHandle(ref, () => ({ addFiles: uploadFiles }));

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDelete = async (att: TaskAttachment): Promise<void> => {
    if (!window.confirm(`Удалить «${att.filename}»?`)) return;
    try {
      await taskRepository.deleteAttachment(projectId, taskId, att.id);
      setItems((prev) => prev.filter((a) => a.id !== att.id));
      onChange();
    } catch (e) {
      toast.error(`Не удалось удалить: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-2" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div className="flex items-center justify-between">
        <Label>Файлы и&nbsp;картинки</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-3.5" />
          Прикрепить
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div
        className={`grid grid-cols-3 gap-2 rounded-md border-2 border-dashed p-2 transition-colors ${
          dragActive ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        {items.map((att) => (
          <button
            key={att.id}
            type="button"
            onClick={() => setPreview(att)}
            className="group relative aspect-square overflow-hidden rounded border bg-muted"
            aria-label={`Открыть ${att.filename}`}
          >
            <AttachmentThumb url={att.url} name={att.filename} mime={att.mimeType} />
            <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
              <p className="w-full truncate px-1.5 pb-1 text-left text-[10px] text-white">
                {att.filename}
              </p>
            </div>
            <span
              role="button"
              aria-label="Удалить"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete(att);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleDelete(att);
                }
              }}
              className="absolute right-1 top-1 grid size-6 cursor-pointer place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
            >
              <Trash2 className="size-3" />
            </span>
          </button>
        ))}
        {Array.from({ length: uploadingCount }).map((_, i) => (
          <div
            key={`uploading-${i}`}
            className="grid aspect-square place-items-center rounded border bg-muted/40"
          >
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ))}
        {items.length === 0 && uploadingCount === 0 && !loading && (
          <div className="col-span-3 grid place-items-center py-6 text-center text-xs text-muted-foreground">
            Перетащи файлы сюда, вставь из&nbsp;буфера (Ctrl+V) или нажми «Прикрепить».
          </div>
        )}
      </div>

      <AttachmentLightbox attachment={preview} onClose={() => setPreview(null)} />
    </div>
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
          maxLength={5000}
          rows={6}
          disabled={saving}
          className="block w-full resize-none rounded-md border border-transparent bg-transparent p-2 text-sm leading-snug focus:outline-none disabled:opacity-50"
        />
        <p className="text-[11px] text-muted-foreground">
          Ctrl+Enter — сохранить, Esc — отменить. {saving && '…'}
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={enterEdit}
      className={cn(
        // p-2 + border 1px + text-sm + leading-snug — те же что у textarea выше.
        'group flex w-full items-start gap-2 rounded-md border border-dashed border-transparent p-2 text-left text-sm leading-snug transition-colors hover:border-border hover:bg-muted/30',
      )}
      aria-label="Редактировать описание"
    >
      <span
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap break-words',
          description.trim().length === 0 && 'italic text-muted-foreground',
        )}
      >
        {description.trim().length > 0 ? description : 'Нажми, чтобы добавить описание…'}
      </span>
      <Pencil
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

// =========================================================
// Comments — список + inline-edit + удаление + бокс «новый комментарий». Старые сверху,
// новые снизу (chat-style). Каждое сообщение — клик по тексту → textarea для редактирования.
// =========================================================

function TaskCommentsSection({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
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
        if (!cancelled) setComments(list);
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
  }, [projectId, taskId, taskRepository, projectRepository]);

  const handleUpdated = (updated: TaskComment): void => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleDeleted = (id: string): void => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const handleCreated = (created: TaskComment): void => {
    setComments((prev) => [...prev, created]);
  };

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

      <CommentComposer
        projectId={projectId}
        taskId={taskId}
        members={members}
        onCreated={handleCreated}
      />
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
      const created = await taskRepository.createComment(projectId, taskId, trimmed || ' ');
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
        <span className="ml-auto text-[10px] text-muted-foreground/60">Markdown + HTML</span>
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
    <li className="group flex items-start gap-2.5 py-1">
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

