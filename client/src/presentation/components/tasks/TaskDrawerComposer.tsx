import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Task, TaskStatus } from '@/domain/task/Task';
import type { NotifyAudience, TaskComment } from '@/domain/task/TaskComment';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { NotifyAudienceControl } from '@/presentation/components/tasks/NotifyAudienceControl';
import { SendTargetButton } from '@/presentation/components/tasks/SendTargetButton';
import { isImageMime } from '@/presentation/components/attachments/files';
import type { MentionMember } from '@/presentation/components/editor/RichTextEditor';

// Tiptap-редактор грузим лениво (тяжёлый chunk, не нужен на read-heavy экранах).
const RichTextEditor = lazy(() =>
  import('@/presentation/components/editor/RichTextEditor').then((m) => ({
    default: m.RichTextEditor,
  })),
);

type PendingFile = {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
};

type ComposerTarget = 'draft' | 'worker';

const DRAWER_TARGETS = [
  { value: 'draft', label: 'В черновики' },
  { value: 'worker', label: 'Воркеру' },
] as const;

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

export function TaskDrawerComposer({
  task,
  backlogTail,
  todoTail,
  onCommentCreated,
  onTaskChanged,
}: Props): React.ReactElement {
  const { taskRepository, projectRepository } = useContainer();
  const { user: currentUser } = useCurrentUser();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  // Адресация уведомления (по умолчанию — все участники).
  const [notify, setNotify] = useState<NotifyAudience>({ mode: 'all' });
  // На awaiting_clarification дефолт = «Воркеру»: юзер отвечает на ralph-question и
  // ожидаемое действие — продолжить работу. На остальных статусах берём из localStorage'а.
  const [target, setTarget] = useState<ComposerTarget>(() =>
    task.status === 'awaiting_clarification' ? 'worker' : readTarget(task.projectId),
  );
  const [submitting, setSubmitting] = useState(false);
  // Участники проекта для @-упоминаний. Грузим как TaskCommentsSection; ошибка не блокирует
  // композер (degrade gracefully — без упоминаний).
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(targetStorageKey(task.projectId), target);
  }, [task.projectId, target]);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .listMembers(task.projectId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        /* tolerate — без members просто нет @-упоминаний */
      });
    return () => {
      cancelled = true;
    };
  }, [task.projectId, projectRepository]);

  // Кандидаты в @-упоминания — все участники кроме автора.
  const mentionMembers: MentionMember[] = members
    .filter((m) => m.userId !== currentUser?.id)
    .map((m) => ({ userId: m.userId, displayName: m.user.displayName }));

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

  const submit = async (): Promise<void> => {
    const trimmed = body.trim();
    if ((trimmed.length === 0 && pending.length === 0) || submitting) return;
    setSubmitting(true);
    try {
      const created = await taskRepository.createComment(
        task.projectId,
        task.id,
        trimmed || ' ',
        notify,
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

      <Suspense fallback={<div className="px-4 py-2.5 text-sm leading-snug">{body}</div>}>
        <RichTextEditor
          variant="comment"
          value={body}
          onChange={setBody}
          onSubmit={() => void submit()}
          members={mentionMembers}
          onPasteFiles={addFiles}
          disabled={submitting}
          placeholder="Комментарий…"
          className="px-4 py-2.5 text-sm leading-snug"
        />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="group/at size-8 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            aria-label="Прикрепить файл"
            title="Прикрепить файл (или Ctrl+V)"
          >
            <Paperclip className="size-4 transition-transform duration-150 group-hover/at:-rotate-12 group-hover/at:scale-110" />
          </Button>
          <NotifyAudienceControl
            projectId={task.projectId}
            excludeUserId={currentUser?.id ?? null}
            value={notify}
            onChange={setNotify}
            disabled={submitting}
          />
        </div>

        <SendTargetButton
          size="sm"
          options={DRAWER_TARGETS}
          value={target}
          onChange={setTarget}
          onSend={() => void submit()}
          submitting={submitting}
          disabled={!canSubmit}
          showLabel={false}
        />

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
