import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { CornerDownRight, FileText, Paperclip, X } from 'lucide-react';
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
import { paceAppend } from '@/presentation/components/attachments/pace';
import type {
  MentionMember,
  RichTextEditorHandle,
} from '@/presentation/components/editor/RichTextEditor';

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

type ReplyDraft = { commentId: string; authorName: string; quotedText: string | null };

type Props = {
  task: Task;
  // Последняя задача в целевой колонке backlog/todo — для расчёта beforeTaskId при
  // move'е. Передаётся из TaskDrawer'а (см. KanbanBoard tails).
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  onCommentCreated: (created: TaskComment) => void;
  onTaskChanged: () => void;
  // Ответ/цитата (db/080): на какой коммент отвечаем + опц. фрагмент. Плашка над полем.
  replyDraft?: ReplyDraft | null;
  onClearReply?: () => void;
  onNavigateToComment?: (commentId: string, quotedText?: string | null) => void;
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
  replyDraft,
  onClearReply,
  onNavigateToComment,
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
  const editorRef = useRef<RichTextEditorHandle>(null);
  // После успешной отправки редактор на миг становится disabled (теряет фокус).
  // Возвращаем фокус, когда submit завершился — чтобы можно было сразу печатать дальше.
  const refocusAfterSendRef = useRef(false);

  useEffect(() => {
    if (submitting || !refocusAfterSendRef.current) return;
    refocusAfterSendRef.current = false;
    requestAnimationFrame(() => editorRef.current?.focusEnd());
  }, [submitting]);

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
    // Мало файлов — разом (как раньше); от порога — порциями, чтобы декод пачки превью
    // не фризил UI (см. pace.ts).
    paceAppend(list, (chunk) => {
      setPending((prev) => [
        ...prev,
        ...chunk.map((file) => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : '',
        })),
      ]);
    });
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
        replyDraft
          ? { replyToCommentId: replyDraft.commentId, quotedText: replyDraft.quotedText }
          : undefined,
      );
      onClearReply?.();
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
      refocusAfterSendRef.current = true;
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

  // Notion-style: композер — отдельная «карточка» со скруглением и мягким фокус-рингом,
  // а не плоский футер на всю ширину. БЕЗ backdrop-blur: filter создаёт containing-block
  // для position:fixed и зажимал бы плавающее меню форматирования внутри overflow-hidden
  // карточки композера.
  return (
    <div className="bg-background/95 px-3 pb-3 pt-2">
      <div className="overflow-hidden rounded-2xl border border-input bg-background shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/15">
        {replyDraft && (
          <div className="flex items-center gap-1.5 border-b bg-primary/[0.06] px-3 py-1.5 text-xs text-muted-foreground">
            <CornerDownRight className="size-3 shrink-0 text-primary/70" />
            <button
              type="button"
              onClick={() => onNavigateToComment?.(replyDraft.commentId, replyDraft.quotedText)}
              className="min-w-0 flex-1 truncate text-left hover:text-foreground"
              title="Перейти к исходному комментарию"
            >
              В ответ <span className="font-medium text-foreground/80">{replyDraft.authorName}</span>
              {replyDraft.quotedText ? (
                <span className="text-muted-foreground/80">: «{replyDraft.quotedText}»</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => onClearReply?.()}
              className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Отменить ответ"
              title="Отменить ответ"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b bg-muted/30 px-3 py-1.5">
            {pending.map((pf) => (
              <span
                key={pf.id}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background py-0.5 pl-1.5 pr-1 text-[11px]"
                title={pf.file.name}
              >
                {pf.previewUrl ? (
                  <img src={pf.previewUrl} alt="" decoding="async" loading="lazy" className="size-4 rounded object-cover" />
                ) : (
                  <FileText className="size-3.5 text-muted-foreground" />
                )}
                <span className="max-w-[140px] truncate">{pf.file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(pf.id)}
                  className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
                  aria-label="Убрать"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <Suspense fallback={<div className="px-3.5 py-2.5 text-sm leading-snug">{body}</div>}>
          <RichTextEditor
            ref={editorRef}
            variant="comment"
            value={body}
            onChange={setBody}
            onSubmit={() => void submit()}
            members={mentionMembers}
            onPasteFiles={addFiles}
            disabled={submitting}
            placeholder="Комментарий…"
            className="px-3.5 py-2.5 text-sm leading-snug"
          />
        </Suspense>

        {/* nowrap: кнопка отправки НЕ переносится на отдельную строку на узких экранах —
            левая группа (скрепка + «кому уведомить») сжимается, send всегда справа. */}
        <div className="flex items-center gap-2 px-2 pb-2 pt-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="group/at size-8 shrink-0 rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              aria-label="Прикрепить файл"
              title="Прикрепить файл (или Ctrl+V)"
            >
              <Paperclip className="size-4 transition-transform duration-200 ease-out group-hover/at:-rotate-12 group-hover/at:scale-110" />
            </Button>
            <NotifyAudienceControl
              projectId={task.projectId}
              excludeUserId={currentUser?.id ?? null}
              value={notify}
              onChange={setNotify}
              disabled={submitting}
            />
          </div>

          <div className="shrink-0">
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
    </div>
  );
}
