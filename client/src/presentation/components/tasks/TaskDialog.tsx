import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';
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
import type { Task } from '@/domain/task/Task';
import { taskShortId } from '@/domain/task/Task';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { useContainer } from '@/infrastructure/di/container';
import { TaskCommitsSection } from './TaskCommitsSection';

export type TaskDialogState =
  | { mode: 'create'; status: Task['status'] }
  | { mode: 'edit'; task: Task };

type Props = {
  state: TaskDialogState | null;
  onClose: () => void;
  onSubmit: (input: { description: string }) => Promise<void>;
  // Колбэк когда коммиты или аттачи у задачи поменялись — board перефетчит badge'и.
  onCommitsChange?: () => void;
};

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function TaskDialog({
  state,
  onClose,
  onSubmit,
  onCommitsChange,
}: Props): React.ReactElement {
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setDescription(state.mode === 'edit' ? state.task.description ?? '' : '');
    setError(null);
  }, [state]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (description.trim().length === 0) {
      setError('Введите описание');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ description: description.trim() });
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
      <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle className="flex items-baseline gap-2">
            {state?.mode === 'edit' ? 'Задача' : 'Новая задача'}
            {state?.mode === 'edit' && (
              <span className="font-mono text-xs text-muted-foreground">
                [{taskShortId(state.task.id)}]
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {state?.mode === 'edit'
              ? 'Опиши задачу, прикрепи скриншоты, привяжи коммиты.'
              : 'Опиши задачу. Прикрепить скриншоты можно после создания.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="task-dialog-form"
          onSubmit={handleSubmit}
          className="space-y-4 overflow-y-auto px-6 pb-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Описание</Label>
            <textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={6}
              autoFocus
              placeholder="Что нужно сделать. Контекст, шаги, ссылки."
              className="w-full rounded-md border bg-background p-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}

          {state?.mode === 'edit' && (
            <>
              <AttachmentsSection
                projectId={state.task.projectId}
                taskId={state.task.id}
                onChange={() => onCommitsChange?.()}
              />
              <div className="border-t pt-4">
                <TaskCommitsSection task={state.task} onChange={() => onCommitsChange?.()} />
              </div>
            </>
          )}
        </form>

        <DialogFooter className="border-t bg-background px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="task-dialog-form" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {state?.mode === 'edit' ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================
// Attachments — список + загрузка (file-picker / drag-drop / paste).
// =========================================================
function AttachmentsSection({
  projectId,
  taskId,
  onChange,
}: {
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
    const valid = Array.from(files).filter((f) => {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        toast.error(`Тип файла "${f.type || 'неизвестный'}" не поддерживается — нужны картинки.`);
        return false;
      }
      return true;
    });
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

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>): void => {
    const clipboardItems = e.clipboardData?.items;
    if (!clipboardItems) return;
    const files: File[] = [];
    for (let i = 0; i < clipboardItems.length; i++) {
      const it = clipboardItems[i];
      if (it && it.kind === 'file') {
        const file = it.getAsFile();
        if (file && ACCEPTED_TYPES.includes(file.type)) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void uploadFiles(files);
    }
  };

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
    <div
      className="space-y-2"
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
            // сбрасываем чтобы повторно выбрать тот же файл работало
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
            Перетащи картинки сюда, вставь из&nbsp;буфера (Ctrl+V в&nbsp;этой области) или нажми «Прикрепить».
          </div>
        )}
      </div>

      <ImagePreviewDialog attachment={preview} onClose={() => setPreview(null)} />
    </div>
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
