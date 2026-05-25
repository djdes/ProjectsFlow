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
  // Последняя задача в целевой колонке backlog/todo — для расчёта beforeTaskId при
  // move'е. Передаётся из TaskDrawer'а (см. KanbanBoard tails).
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  onCommentCreated: (created: TaskComment) => void;
  onTaskChanged: () => void;
};

function targetStorageKey(projectId: string): string {
  return `pf.taskComposer.target.${projectId}`;
}

function readTarget(projectId: string): ComposerTarget {
  if (typeof window === 'undefined') return 'draft';
  const raw = window.localStorage.getItem(targetStorageKey(projectId));
  return raw === 'worker' ? 'worker' : 'draft';
}

// Куда move'нуть задачу при текущем статусе + выбранном target'е. null = no move.
function resolveMoveTarget(
  current: TaskStatus,
  target: ComposerTarget,
): TaskStatus | null {
  if (target === 'draft') {
    return current === 'backlog' ? null : 'backlog';
  }
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

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [body]);

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
      const created = await taskRepository.createComment(
        task.projectId,
        task.id,
        trimmed || ' ',
      );
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

      const moveTo = resolveMoveTarget(task.status, target);
      if (moveTo !== null) {
        const tail = moveTo === 'backlog' ? backlogTail : todoTail;
        await taskRepository.move(task.projectId, task.id, {
          targetStatus: moveTo,
          beforeTaskId: tail?.id ?? null,
          afterTaskId: null,
        });
        onTaskChanged();
        toast.success(moveTo === 'todo' ? 'Передано воркеру' : 'Задача в черновиках');
      } else {
        onTaskChanged();
      }

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
