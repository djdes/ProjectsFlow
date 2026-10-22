import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CornerDownRight, FileText, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Task } from '@/domain/task/Task';
import type { NotifyAudience, TaskComment } from '@/domain/task/TaskComment';
import { defaultCommentAudience } from '@/domain/task/defaultCommentAudience';
import {
  acknowledgeComment,
  beginCommentSend,
  commentDraftKey,
  readCommentDraft,
  subscribeCommentDraft,
  updateCommentDraft,
  type CommentReplyDraft,
} from './commentDraft';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { NotifyAudienceControl } from '@/presentation/components/tasks/NotifyAudienceControl';
import { SendTargetButton } from '@/presentation/components/tasks/SendTargetButton';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { isImageFile, localPreviewAttachment } from '@/presentation/components/attachments/files';
import { paceAppend } from '@/presentation/components/attachments/pace';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type {
  MentionMember,
  RichTextEditorHandle,
} from '@/presentation/components/editor/RichTextEditor';
import {
  canChooseSendTarget,
  resolveMoveTarget,
  shouldAutoMoveAfterComment,
  type ComposerTarget,
} from '@/presentation/components/tasks/taskDrawerComposerRules';

// Tiptap-редактор грузим лениво (тяжёлый chunk, не нужен на read-heavy экранах).
const RichTextEditor = lazy(() =>
  import('@/presentation/components/editor/RichTextEditor').then((m) => ({
    default: m.RichTextEditor,
  })),
);

const DRAWER_TARGETS = [
  { value: 'draft', label: 'В черновики' },
  { value: 'worker', label: 'Воркеру' },
] as const;

// Воркер выключен в пространстве (db/152) — «Воркеру» отправлять некуда, остаются черновики.
const DRAWER_TARGETS_NO_WORKER = DRAWER_TARGETS.filter((t) => t.value !== 'worker');

type ReplyDraft = CommentReplyDraft;

type Props = {
  task: Task;
  // Последняя задача в целевой колонке backlog/todo — для расчёта beforeTaskId при
  // move'е. Передаётся из TaskDrawer'а (см. KanbanBoard tails).
  backlogTail: { readonly id: string } | null;
  todoTail: { readonly id: string } | null;
  onCommentCreated: (created: TaskComment) => void;
  onTaskChanged: () => void;
  defaultTarget?: ComposerTarget;
  onWorkerQueued?: () => void;
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
  try {
    return window.localStorage.getItem(targetStorageKey(projectId)) === 'worker' ? 'worker' : 'draft';
  } catch { return 'draft'; }
}

export function TaskDrawerComposer(props: Props): React.ReactElement | null {
  const { user } = useCurrentUser();
  if (!user) return null;
  const draftKey = commentDraftKey(user.id, props.task.projectId, props.task.id);
  return <TaskDrawerComposerForm key={draftKey} {...props} draftKey={draftKey} />;
}

function TaskDrawerComposerForm({
  task,
  backlogTail,
  todoTail,
  onCommentCreated,
  onTaskChanged,
  replyDraft: incomingReply,
  draftKey,
  onClearReply,
  onNavigateToComment,
  defaultTarget,
  onWorkerQueued,
}: Props & { draftKey: string }): React.ReactElement {
  const { taskRepository, projectRepository } = useContainer();
  const { user: currentUser } = useCurrentUser();
  const subscribe = useCallback((listener: () => void) => subscribeCommentDraft(draftKey, listener), [draftKey]);
  const getSnapshot = useCallback(() => readCommentDraft(draftKey), [draftKey]);
  const draft = useSyncExternalStore(subscribe, getSnapshot);
  const { body, files: pending, reply: replyDraft, sending: submitting } = draft;
  const defaultAudience = defaultCommentAudience(task.assignee?.userId ?? null, currentUser?.id ?? null);
  const notify = draft.notify ?? defaultAudience;
  const setBody = (value: string): void => updateCommentDraft(draftKey, (current) => ({ ...current, body: value }));
  const setNotify = (value: NotifyAudience): void => updateCommentDraft(draftKey, (current) => ({ ...current, notify: value }));
  useEffect(() => {
    if (incomingReply) updateCommentDraft(draftKey, (current) => ({ ...current, reply: incomingReply }));
  }, [draftKey, incomingReply]);
  const clearReply = (): void => {
    updateCommentDraft(draftKey, (current) => ({ ...current, reply: null }));
    onClearReply?.();
  };
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // Открытая на просмотр прикреплённая картинка (ещё не загруженная — url это blob-превью).
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  // На awaiting_clarification дефолт = «Воркеру»: юзер отвечает на ralph-question и
  // ожидаемое действие — продолжить работу. На остальных статусах берём из localStorage'а.
  const [target, setTarget] = useState<ComposerTarget>(() =>
    defaultTarget ?? (task.status === 'awaiting_clarification' ? 'worker' : readTarget(task.projectId)),
  );
  // Сохранённый в localStorage выбор «Воркеру» переживает выключение воркера — схлопываем
  // его в черновики, иначе кнопка целилась бы в статус, который сервер уже не принимает.
  const workerEnabled = useWorkerEnabled();
  const effectiveTarget: ComposerTarget = workerEnabled ? target : 'draft';
  // Участники проекта для @-упоминаний. Грузим как TaskCommentsSection; ошибка не блокирует
  // композер (degrade gracefully — без упоминаний).
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Телефон: пока в композере фокус, его карточка целиком над клавиатурой. Браузер сам
  // докручивает только строку с кареткой, и ряд с кнопкой «Отправить» оставался под
  // клавиатурой. Клавиатура открывается после фокуса — ловим и сам фокус, и сжатие
  // visualViewport, когда она выехала.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const reveal = (): void => {
      // Только телефон: на десктопе клавиатуры поверх нет, а лишняя докрутка двигала бы окно.
      if (!window.matchMedia('(max-width: 639px)').matches) return;
      if (!root.contains(document.activeElement)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => root.scrollIntoView({ block: 'nearest' }));
    };
    root.addEventListener('focusin', reveal);
    viewport?.addEventListener('resize', reveal);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('focusin', reveal);
      viewport?.removeEventListener('resize', reveal);
    };
  }, []);
  // После успешной отправки редактор на миг становится disabled (теряет фокус).
  // Возвращаем фокус, когда submit завершился — чтобы можно было сразу печатать дальше.
  const refocusAfterSendRef = useRef(false);

  useEffect(() => {
    if (submitting || !refocusAfterSendRef.current) return;
    refocusAfterSendRef.current = false;
    requestAnimationFrame(() => editorRef.current?.focusEnd());
  }, [submitting]);

  useEffect(() => {
    if (typeof window === 'undefined' || defaultTarget !== undefined) return;
    try { window.localStorage.setItem(targetStorageKey(task.projectId), target); } catch { /* Optional preference. */ }
  }, [task.projectId, target, defaultTarget]);

  useEffect(() => {
    let cancelled = false;
    (task.context?.canReadProject === false ? Promise.resolve([]) : projectRepository.listMembers(task.projectId))
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        /* tolerate — без members просто нет @-упоминаний */
      });
    return () => {
      cancelled = true;
    };
  }, [task.projectId, projectRepository, task.context?.canReadProject]);

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
      updateCommentDraft(draftKey, (current) => ({ ...current, files: [
        ...current.files,
        ...chunk.map((file) => ({
          id: crypto.randomUUID(),
          file,
          // По MIME И по расширению: из мессенджеров/буфера файл нередко приходит с пустым
          // type, а превью (и просмотр по клику) всё равно должны работать.
          previewUrl: isImageFile(file.type, file.name) ? URL.createObjectURL(file) : '',
        })),
      ] }));
    });
  };

  const removeFile = (id: string): void => {
    // Лайтбокс держит тот же blob-URL — закрываем, иначе он покажет отозванную ссылку.
    setPreview((cur) => (cur?.id === id ? null : cur));
    updateCommentDraft(draftKey, (current) => ({ ...current, files: current.files.filter((file) => file.id !== id) }));
  };

  const submit = async (): Promise<void> => {
    const sent = beginCommentSend(draftKey);
    if (!sent) return;
    let created: TaskComment;
    try {
      created = await taskRepository.createComment(
        task.projectId,
        task.id,
        sent.body.trim() || ' ',
        sent.notify ?? defaultAudience,
        sent.reply ? { replyToCommentId: sent.reply.commentId, quotedText: sent.reply.quotedText } : undefined,
      );
    } catch (error) {
      toast.error(`Не удалось отправить: ${(error as Error).message}`);
      updateCommentDraft(draftKey, (current) => ({ ...current, sending: false }));
      return;
    }

    // The server accepted this text. A later upload/move failure must not resend it.
    acknowledgeComment(draftKey, sent);
    try {
      onClearReply?.();
      const uploaded: TaskAttachment[] = [];
      for (const file of sent.files) {
        try {
          uploaded.push(await taskRepository.uploadCommentAttachment(task.projectId, task.id, created.id, file.file));
          updateCommentDraft(draftKey, (current) => ({ ...current, files: current.files.filter((entry) => entry.id !== file.id) }));
        } catch (error) {
          toast.error(`Не удалось загрузить ${file.file.name}: ${(error as Error).message}`);
        }
      }
      if (mountedRef.current) {
        setPreview(null);
        onCommentCreated({ ...created, attachments: uploaded });
      }
      const moveTo = shouldAutoMoveAfterComment(task, currentUser?.id ?? null)
        ? resolveMoveTarget(task.status, effectiveTarget)
        : null;
      if (moveTo !== null) {
        const tail = moveTo === 'backlog' ? backlogTail : todoTail;
        try {
          await taskRepository.move(task.projectId, task.id, {
            targetStatus: moveTo, beforeTaskId: tail?.id ?? null, afterTaskId: null,
          });
          if (moveTo === 'todo') onWorkerQueued?.();
          toast.success(moveTo === 'todo' ? 'Задача в очереди воркера' : 'Задача в черновиках');
        } catch (error) {
          toast.error(`Комментарий отправлен, но не удалось изменить статус: ${(error as Error).message}`);
        }
      }
      if (moveTo === null && effectiveTarget === 'worker' && task.status === 'todo') onWorkerQueued?.();
      if (mountedRef.current) onTaskChanged();
    } finally {
      if (mountedRef.current) refocusAfterSendRef.current = true;
      updateCommentDraft(draftKey, (current) => ({ ...current, sending: false }));
    }
  };

  const canSubmit = (body.trim().length > 0 || pending.length > 0) && !submitting;

  // Notion-style: композер — отдельная «карточка» со скруглением и мягким фокус-рингом,
  // а не плоский футер на всю ширину. БЕЗ backdrop-blur: filter создаёт containing-block
  // для position:fixed и зажимал бы плавающее меню форматирования внутри overflow-hidden
  // карточки композера.
  return (
    <div ref={rootRef} className="bg-background/95 px-3 pbe-3 pbs-2">
      <div className="overflow-clip rounded-2xl border border-input bg-background shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/15">
        {replyDraft && (
          <div className="flex items-center gap-1.5 border-be bg-primary/[0.06] px-3 py-1.5 text-xs text-muted-foreground">
            <CornerDownRight className="size-3 shrink-0 text-primary/70" />
            <button
              type="button"
              onClick={() => onNavigateToComment?.(replyDraft.commentId, replyDraft.quotedText)}
              className="min-w-0 flex-1 truncate text-start hover:text-foreground"
              title="Перейти к исходному комментарию"
            >
              В ответ <span className="font-medium text-foreground/80">{replyDraft.authorName}</span>
              {replyDraft.quotedText ? (
                <span className="text-muted-foreground/80">: «{replyDraft.quotedText}»</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={clearReply}
              className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Отменить ответ"
              title="Отменить ответ"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-be bg-muted/30 px-3 py-1.5">
            {pending.map((pf) => (
              <span
                key={pf.id}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background py-0.5 ps-1.5 pe-1 text-2xs"
                title={pf.file.name}
              >
                {/* Картинку можно рассмотреть ДО отправки — клик открывает лайтбокс на
                    blob-превью. Не-картинки остаются просто чипом (открывать нечего). */}
                {pf.previewUrl ? (
                  <button
                    type="button"
                    onClick={() => setPreview(localPreviewAttachment({
                      id: pf.id,
                      filename: pf.file.name,
                      mimeType: pf.file.type,
                      sizeBytes: pf.file.size,
                      url: pf.previewUrl,
                    }))}
                    className="flex min-w-0 items-center gap-1.5"
                    aria-label={`Открыть ${pf.file.name}`}
                  >
                    <img src={pf.previewUrl} alt="" decoding="async" loading="lazy" className="size-4 rounded object-cover" />
                    <span className="max-w-[140px] truncate">{pf.file.name}</span>
                  </button>
                ) : (
                  <>
                    <FileText className="size-3.5 text-muted-foreground" />
                    <span className="max-w-[140px] truncate">{pf.file.name}</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(pf.id)}
                  className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
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
        <div className="flex items-center gap-2 px-2 pbe-2 pbs-0.5">
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
              <Paperclip className="size-4 motion-safe:transition-transform duration-200 ease-out group-hover/at:-rotate-12 group-hover/at:scale-110" />
            </Button>
            <NotifyAudienceControl
              projectId={task.projectId}
              excludeUserId={currentUser?.id ?? null}
              members={members}
              assignee={task.assignee}
              defaultAudience={defaultAudience}
              value={notify}
              onChange={setNotify}
              disabled={submitting}
            />
          </div>

          <div className="shrink-0">
            {canChooseSendTarget(task.status) ? (
              <SendTargetButton
                size="sm"
                options={workerEnabled ? DRAWER_TARGETS : DRAWER_TARGETS_NO_WORKER}
                value={effectiveTarget}
                onChange={setTarget}
                onSend={() => void submit()}
                submitting={submitting}
                disabled={!canSubmit}
              />
            ) : (
              // «Вручную» и кастомные колонки не двигаются от комментария — показываем
              // обычную кнопку отправки, без подписи цели, которая обещала бы перенос.
              <SendTargetButton
                size="sm"
                onSend={() => void submit()}
                submitting={submitting}
                disabled={!canSubmit}
              />
            )}
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

      <AttachmentLightbox attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
