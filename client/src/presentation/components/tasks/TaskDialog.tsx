import {
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
import { ImagePlus, Loader2, Pencil, Send, Trash2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Task } from '@/domain/task/Task';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { TaskComment } from '@/domain/task/TaskComment';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { getInitials } from '@/presentation/layout/projectIcons';
import { TaskCommitsSection } from './TaskCommitsSection';

export type TaskDialogState =
  | { mode: 'create'; status: Task['status'] }
  | { mode: 'edit'; task: Task };

type Props = {
  state: TaskDialogState | null;
  onClose: () => void;
  // Возвращает созданный/обновлённый task — нужен в create-режиме, чтобы зааплоадить
  // pending-аттачи после получения task.id.
  onSubmit: (input: { description: string }) => Promise<Task>;
  // Колбэк когда коммиты или аттачи у задачи поменялись — board перефетчит badge'и.
  onCommitsChange?: () => void;
  // Показывать секцию коммитов в edit-режиме. Для inbox-проекта выключаем — у него
  // нет git-репо, привязывать нечего.
  showCommits?: boolean;
  // Имя проекта — рисуем в шапке диалога как контекстный заголовок. В inbox не передаём.
  projectName?: string;
};

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Извлекает image-файлы из ClipboardEvent. Возвращает пустой массив если ничего
// подходящего нет — caller'у тогда нужно дать textarea/контролу обработать paste
// как обычно (не делать preventDefault).
function extractClipboardImages(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const out: File[] = [];
  for (let i = 0; i < clipboardData.items.length; i++) {
    const it = clipboardData.items[i];
    if (it && it.kind === 'file') {
      const file = it.getAsFile();
      if (file && ACCEPTED_TYPES.includes(file.type)) out.push(file);
    }
  }
  return out;
}

function filterValidImageFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((f) => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      toast.error(`Тип файла "${f.type || 'неизвестный'}" не поддерживается — нужны картинки.`);
      return false;
    }
    return true;
  });
}

export function TaskDialog({
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
  // В edit-режиме секция аттачей экспонирует addFiles через ref — чтобы paste-handler
  // на форме (поймает Ctrl+V даже когда фокус в textarea) мог пнуть аплоад.
  const attachmentsRef = useRef<AttachmentsHandle>(null);

  useEffect(() => {
    if (!state) return;
    setDescription(state.mode === 'edit' ? state.task.description ?? '' : '');
    setError(null);
    // При закрытии/смене диалога чистим pending — URL.revokeObjectURL для blob'ов.
    setPendingFiles((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, [state]);

  const addPendingFiles = (raw: FileList | File[]): void => {
    const valid = filterValidImageFiles(raw);
    if (valid.length === 0) return;
    const additions: PendingFile[] = valid.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingFiles((prev) => [...prev, ...additions]);
  };

  // Form-level paste handler — ловит Ctrl+V где угодно внутри формы (textarea, секция, пустое место).
  // Если в буфере есть картинки — preventDefault (textarea не вставит binary-кашу) и роутим в нужную секцию.
  // Если картинок нет — просто пускаем дефолтное поведение (текст ↦ в textarea).
  const handleFormPaste = (e: ClipboardEvent<HTMLFormElement>): void => {
    const files = extractClipboardImages(e.clipboardData);
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
      const task = await onSubmit({ description: description.trim() });
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
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {/* max-h + grid с прижатыми header/footer и скроллом в body — чтоб длинные секции
          (особенно коммиты + пикер) не выезжали за viewport. */}
      <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pb-2 pt-4">
          {/* Title/Description обязаны существовать для a11y (Radix), но визуально не нужны.
              Видимый контент шапки — название проекта (контекст «к какому проекту таска»). */}
          <DialogTitle className="sr-only">
            {state?.mode === 'edit' ? 'Задача' : 'Новая задача'}
            {projectName ? ` · ${projectName}` : ''}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {state?.mode === 'edit' ? 'Редактирование задачи' : 'Создание новой задачи'}
          </DialogDescription>
          {projectName && (
            <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {projectName}
            </span>
          )}
        </DialogHeader>

        <form
          id="task-dialog-form"
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={6}
              autoFocus
              placeholder="Что нужно сделать. Контекст, шаги, ссылки. Ctrl+V — картинка пойдёт в аттачи."
              className="w-full rounded-md border bg-background p-2 text-sm"
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
          )}
        </form>

        <DialogFooter className="border-t bg-background px-6 py-4">
          {state?.mode === 'edit' ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" form="task-dialog-form" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Создать
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <Label>Картинки и скриншоты</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="size-3.5" />
          Прикрепить
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
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
            <img
              src={pf.previewUrl}
              alt={pf.file.name}
              loading="lazy"
              className="size-full object-cover"
            />
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
            Перетащи картинки сюда, вставь из&nbsp;буфера (Ctrl+V) или нажми «Прикрепить».
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
    const valid = filterValidImageFiles(files);
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
        <Label>Картинки и скриншоты</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="size-3.5" />
          Прикрепить
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
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
            <img
              src={att.url}
              alt={att.filename}
              loading="lazy"
              className="size-full object-cover"
            />
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
            Перетащи картинки сюда, вставь из&nbsp;буфера (Ctrl+V) или нажми «Прикрепить».
          </div>
        )}
      </div>

      <ImagePreviewDialog attachment={preview} onClose={() => setPreview(null)} />
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
  const { taskRepository } = useContainer();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, taskRepository]);

  const submit = async (): Promise<void> => {
    const trimmed = newBody.trim();
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const created = await taskRepository.createComment(projectId, taskId, trimmed);
      setComments((prev) => [...prev, created]);
      setNewBody('');
    } catch (e) {
      toast.error(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdated = (updated: TaskComment): void => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleDeleted = (id: string): void => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const handleNewKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
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

      <div className="relative rounded-md border bg-card transition-colors focus-within:border-foreground/30">
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={handleNewKeyDown}
          rows={2}
          disabled={submitting}
          placeholder="Написать комментарий…"
          className="block w-full resize-none rounded-md bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1.5 top-1.5 size-7"
          onClick={() => void submit()}
          disabled={submitting || newBody.trim().length === 0}
          aria-label="Отправить"
        >
          {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </Button>
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
      onUpdated(updated);
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
  const displayName = user?.displayName ?? '—';
  const initials = getInitials(displayName);

  return (
    <li className="group flex items-start gap-2.5 py-1">
      <Avatar className="size-7 shrink-0">
        {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={displayName} /> : null}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-medium">{displayName}</span>
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
          <button
            type="button"
            onClick={enterEdit}
            className="mt-0.5 block w-full cursor-text whitespace-pre-wrap break-words text-left text-sm leading-snug"
            aria-label="Редактировать комментарий"
          >
            {comment.body}
          </button>
        )}
      </div>
    </li>
  );
}

function ImagePreviewDialog({
  attachment,
  onClose,
}: {
  attachment: TaskAttachment | null;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Dialog open={attachment !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="truncate text-sm font-medium">{attachment?.filename ?? ''}</p>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid place-items-center overflow-auto bg-muted/30 p-4">
          {attachment && (
            <img
              src={attachment.url}
              alt={attachment.filename}
              className="max-h-[78vh] max-w-full object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
