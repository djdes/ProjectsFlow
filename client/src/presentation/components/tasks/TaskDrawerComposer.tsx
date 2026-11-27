import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { CornerDownRight, Paperclip, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { workerSessionPrompt, type WorkerSessionMode } from '@/domain/task/WorkerSessionMode';
import type { NotifyAudience, TaskComment } from '@/domain/task/TaskComment';
import { defaultCommentAudience } from '@/domain/task/defaultCommentAudience';
import {
  acknowledgeComment,
  appendCommentDraftFiles,
  beginCommentSend,
  commentDraftKey,
  readCommentDraft,
  subscribeCommentDraft,
  updateCommentDraft,
  type CommentReplyDraft,
} from './commentDraft';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useContainer } from '@/infrastructure/di/container';
import { useAwaitingReply } from '@/presentation/hooks/AwaitingReplyProvider';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCommentNotifyCandidates } from '@/presentation/hooks/useCommentNotifyCandidates';
import { NotifyAudienceControl } from '@/presentation/components/tasks/NotifyAudienceControl';
import { SendTargetButton } from '@/presentation/components/tasks/SendTargetButton';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { formatBytes, localPreviewAttachment } from '@/presentation/components/attachments/files';
import { runFilesLimited } from '@/presentation/components/attachments/pace';
import { fileKindMeta } from '@/presentation/components/tasks/CommentAttachments';
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
  onCommentUpdated?: (updated: TaskComment) => void;
  onCommentDeleted?: (commentId: string) => void;
  onTaskChanged: () => void;
  onApprovalReturned?: (updated: Task) => void;
  defaultTarget?: ComposerTarget;
  // Сообщает подтверждённую сервером задачу в статусе «Воркер».
  onWorkerQueued?: (updated: Task) => void;
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
  return <TaskDrawerComposerForm key={`${draftKey}:${props.task.status === 'pending_approval'}`} {...props} draftKey={draftKey} />;
}

function TaskDrawerComposerForm({
  task,
  backlogTail,
  todoTail,
  onCommentCreated,
  onCommentUpdated,
  onCommentDeleted,
  onTaskChanged,
  onApprovalReturned,
  replyDraft: incomingReply,
  draftKey,
  onClearReply,
  onNavigateToComment,
  defaultTarget,
  onWorkerQueued,
}: Props & { draftKey: string }): React.ReactElement {
  const { taskRepository, projectRepository } = useContainer();
  const { markAnswered } = useAwaitingReply();
  const { user: currentUser } = useCurrentUser();
  const subscribe = useCallback((listener: () => void) => subscribeCommentDraft(draftKey, listener), [draftKey]);
  const getSnapshot = useCallback(() => readCommentDraft(draftKey), [draftKey]);
  const draft = useSyncExternalStore(subscribe, getSnapshot);
  const { body, files: pending, reply: replyDraft, sending: submitting } = draft;
  const awaitingApproval = task.status === 'pending_approval';
  const canReturn = awaitingApproval && onApprovalReturned !== undefined;
  const [returnChecked, setReturnChecked] = useState(true);
  const returnCheckboxId = useId();
  const returnOnSend = canReturn && returnChecked;
  // Кого можно уведомить и кто по умолчанию (руководитель) — решает сервер.
  const notifyCandidates = useCommentNotifyCandidates(task.projectId, task.id);
  const defaultAudience = defaultCommentAudience(
    notifyCandidates.candidates,
    task.assignee?.userId ?? null,
    currentUser?.id ?? null,
  );
  const notify = draft.notify ?? defaultAudience;
  const setBody = (value: string): void => updateCommentDraft(draftKey, (current) => ({ ...current, body: value }));
  const setNotify = (value: NotifyAudience): void => updateCommentDraft(draftKey, (current) => ({ ...current, notify: value }));
  useEffect(() => {
    if (incomingReply) updateCommentDraft(draftKey, (current) => ({ ...current, reply: incomingReply }));
  }, [draftKey, incomingReply]);
  // «Ответить» сразу ставит каретку в поле: иначе после клика приходилось ещё раз тянуться
  // к композеру. Layout-эффект — в том же жесте, что и клик (iOS поднимает клавиатуру
  // только на фокус внутри жеста пользователя).
  const lastReplyRef = useRef(incomingReply);
  useLayoutEffect(() => {
    if (!incomingReply || incomingReply === lastReplyRef.current) return;
    lastReplyRef.current = incomingReply;
    editorRef.current?.focusEnd();
  }, [incomingReply]);
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
  const [sessionMode, setSessionMode] = useState<WorkerSessionMode>('continue');
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
    appendCommentDraftFiles(draftKey, raw);
  };

  // Файлы, которые уже ушли в созданный комментарий и сейчас догружаются фоном:
  // в самом композере их чипы скрываем, чтобы поле сразу освобождалось для следующего сообщения.
  const [uploadingIds, setUploadingIds] = useState<ReadonlySet<string>>(() => new Set());
  const visiblePending = pending.filter((pf) => !uploadingIds.has(pf.id));

  // Прямой drag & drop файлов/фото прямо в карточку композера комментария.
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const hasDragFiles = (e: DragEvent<HTMLElement>): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const handleDragEnter = (e: DragEvent<HTMLElement>): void => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragOver(true);
  };
  const handleDragOver = (e: DragEvent<HTMLElement>): void => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLElement>): void => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragOver(false);
    }
  };
  const handleDrop = (e: DragEvent<HTMLElement>): void => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) addFiles(dropped);
  };

  const removeFile = (id: string): void => {
    // Лайтбокс держит тот же blob-URL — закрываем, иначе он покажет отозванную ссылку.
    setPreview((cur) => (cur?.id === id ? null : cur));
    updateCommentDraft(draftKey, (current) => ({ ...current, files: current.files.filter((file) => file.id !== id) }));
  };

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    const sent = beginCommentSend(draftKey);
    if (!sent) return;
    let created: TaskComment;
    let returnedTask: Task | null = null;
    const text = sent.body.trim();
    const notify = sent.notify ?? defaultAudience;
    const reply = { replyToCommentId: sent.reply?.commentId, quotedText: sent.reply?.quotedText };
    try {
      if (returnOnSend) {
        const result = await taskRepository.rejectApproval(task.projectId, task.id, text, { notify, ...reply });
        created = result.comment;
        if (result.returned) returnedTask = result.task;
        else toast.error('Комментарий отправлен, но задачу вернуть не удалось');
      } else {
        created = await taskRepository.createComment(
          task.projectId,
          task.id,
          !awaitingApproval && effectiveTarget === 'worker' ? workerSessionPrompt(text, sessionMode) : text,
          notify,
          { ...reply, attachmentCount: sent.files.length },
        );
      }
    } catch (error) {
      toast.error(`Не удалось отправить: ${(error as Error).message}`);
      updateCommentDraft(draftKey, (current) => ({ ...current, sending: false }));
      return;
    }

    // The server accepted this text. A later upload/move failure must not resend it.
    acknowledgeComment(draftKey, sent);
    markAnswered(task.id);
    setSessionMode('continue');
    onClearReply?.();

    // Комментарий появляется в ленте СРАЗУ после ответа createComment, не дожидаясь
    // многомегабайтной загрузки файлов: фото уже видны по локальным blob-превью, а
    // композер тут же разблокируется для следующего сообщения.
    const attachmentMap = new Map<string, TaskAttachment>(
      sent.files.map((file) => [
        file.id,
        {
          ...localPreviewAttachment({
            id: file.id,
            filename: file.file.name,
            mimeType: file.file.type,
            sizeBytes: file.file.size,
            url: file.previewUrl,
          }),
          taskId: task.id,
          uploading: true,
          uploadProgress: 0,
        },
      ]),
    );
    let notifiedCreated = false;
    if (mountedRef.current) {
      setPreview(null);
      onCommentCreated({ ...created, attachments: [...attachmentMap.values()] });
      notifiedCreated = true;
    }
    if (sent.files.length > 0 && mountedRef.current) {
      setUploadingIds((prev) => {
        const next = new Set(prev);
        for (const f of sent.files) next.add(f.id);
        return next;
      });
    }
    if (mountedRef.current) refocusAfterSendRef.current = true;
    updateCommentDraft(draftKey, (current) => ({ ...current, sending: false }));

    const publishAttachments = (): void => {
      if (!mountedRef.current) return;
      const snapshot = { ...created, attachments: [...attachmentMap.values()] };
      if (!notifiedCreated) {
        notifiedCreated = true;
        onCommentCreated(snapshot);
      } else {
        onCommentUpdated?.(snapshot);
      }
    };

    try {
      const uploaded: TaskAttachment[] = [];
      if (sent.files.length > 0) {
        await runFilesLimited(sent.files, async (file) => {
          try {
            const saved = await taskRepository.uploadCommentAttachment(
              task.projectId,
              task.id,
              created.id,
              file.file,
              (loaded, total) => {
                const cur = attachmentMap.get(file.id);
                if (!cur) return;
                const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
                attachmentMap.set(file.id, { ...cur, uploadProgress: progress });
                publishAttachments();
              },
            );
            uploaded.push(saved);
            attachmentMap.set(file.id, saved);
            updateCommentDraft(draftKey, (current) => ({
              ...current,
              files: current.files.filter((entry) => entry.id !== file.id),
            }));
            publishAttachments();
          } catch (error) {
            attachmentMap.delete(file.id);
            publishAttachments();
            toast.error(`Не удалось загрузить ${file.file.name}: ${(error as Error).message}`);
          } finally {
            if (mountedRef.current) {
              setUploadingIds((prev) => {
                if (!prev.has(file.id)) return prev;
                const next = new Set(prev);
                next.delete(file.id);
                return next;
              });
            }
          }
        });
      }
      // Комментарий без текста держался на вложениях. Не загрузилось ни одно — убираем
      // пустой комментарий; файлы остаются в черновике для повторной отправки.
      if (text.length === 0 && sent.files.length > 0 && uploaded.length === 0) {
        if (mountedRef.current) onCommentDeleted?.(created.id);
        await taskRepository.deleteComment(task.projectId, task.id, created.id).catch(() => undefined);
        return;
      }
      publishAttachments();
      const moveTo = !awaitingApproval && task.canEdit !== false && shouldAutoMoveAfterComment(task, currentUser?.id ?? null)
        ? resolveMoveTarget(task.status, effectiveTarget)
        : null;
      if (moveTo !== null) {
        const tail = moveTo === 'backlog' ? backlogTail : todoTail;
        try {
          const moved = await taskRepository.move(task.projectId, task.id, {
            targetStatus: moveTo, beforeTaskId: tail?.id ?? null, afterTaskId: null,
          });
          if (moved.status !== moveTo) throw new Error(`сервер оставил статус «${moved.status}»`);
          if (moveTo === 'todo') onWorkerQueued?.(moved);
          toast.success(moveTo === 'todo' ? 'Задача в очереди воркера' : 'Задача в черновиках');
        } catch (error) {
          toast.error(`Комментарий отправлен, но не удалось изменить статус: ${(error as Error).message}`);
        }
      }
      if (moveTo === null && effectiveTarget === 'worker' && task.status === 'todo') onWorkerQueued?.(task);
      if (returnedTask) {
        toast.success('Задача возвращена исполнителю');
        if (mountedRef.current) onApprovalReturned?.(returnedTask);
      }
      if (mountedRef.current) onTaskChanged();
    } finally {
      updateCommentDraft(draftKey, (current) => (current.sending ? { ...current, sending: false } : current));
    }
  };

  const canSubmit = (body.trim().length > 0 || (!returnOnSend && visiblePending.length > 0)) && !submitting;

  // Notion-style: композер — отдельная «карточка» со скруглением и мягким фокус-рингом,
  // а не плоский футер на всю ширину. БЕЗ backdrop-blur: filter создаёт containing-block
  // для position:fixed и зажимал бы плавающее меню форматирования внутри overflow-hidden
  // карточки композера.
  return (
    <div
      ref={rootRef}
      data-pf-comment-composer
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="bg-background/95 px-3 pbe-3 pbs-2"
    >
      <div
        data-replying={replyDraft ? '' : undefined}
        data-drag-over={dragOver ? '' : undefined}
        className={cn(
          'pf-comment-composer-card relative overflow-clip rounded-3xl transition-shadow',
          dragOver && 'ring-2 ring-primary bg-primary/[0.05]',
        )}
      >
        {dragOver && (
          <div className="pointer-events-none flex items-center justify-center gap-2 bg-primary/[0.1] px-3 py-2 text-xs font-medium text-primary">
            <UploadCloud className="size-4 shrink-0" />
            <span>Отпустите файлы или фото, чтобы прикрепить к комментарию</span>
          </div>
        )}
        {replyDraft && (
          <div
            key={replyDraft.commentId}
            className="pf-comment-reply-strip flex items-center gap-1.5 py-1.5 pe-2 ps-3.5 text-xs text-muted-foreground"
          >
            <CornerDownRight className="size-3.5 shrink-0 text-primary" />
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
              className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              aria-label="Отменить ответ"
              title="Отменить ответ"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {visiblePending.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pbs-2.5">
            {visiblePending.map((pf) => {
              const meta = fileKindMeta(pf.file.name, pf.file.type);
              const Icon = meta.Icon;
              return (
                <span
                  key={pf.id}
                  className="pf-comment-chip group/chip inline-flex max-w-[230px] items-center gap-2 rounded-2xl bg-background/90 py-1.5 ps-1.5 pe-2 text-xs"
                  title={pf.file.name}
                >
                  {/* Картинку можно рассмотреть ДО отправки — клик открывает лайтбокс на
                      blob-превью. */}
                  {pf.previewUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPreview(
                          localPreviewAttachment({
                            id: pf.id,
                            filename: pf.file.name,
                            mimeType: pf.file.type,
                            sizeBytes: pf.file.size,
                            url: pf.previewUrl,
                          }),
                        )
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-start"
                      aria-label={`Открыть ${pf.file.name}`}
                    >
                      <img
                        src={pf.previewUrl}
                        alt=""
                        decoding="async"
                        loading="lazy"
                        className="size-10 shrink-0 rounded-xl object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {pf.file.name}
                        </span>
                        <span className="block text-2xs text-muted-foreground tabular-nums">
                          Фото · {formatBytes(pf.file.size)}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={cn(
                          'flex size-9 shrink-0 flex-col items-center justify-center rounded-xl',
                          meta.badgeClass,
                        )}
                      >
                        <Icon className="size-3.5 shrink-0" />
                        <span className="text-[8px] font-bold leading-none">{meta.ext}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {pf.file.name}
                        </span>
                        <span className="block text-2xs text-muted-foreground tabular-nums">
                          {formatBytes(pf.file.size)}
                        </span>
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(pf.id)}
                    className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                    aria-label="Убрать"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
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

        {task.canEdit !== false && effectiveTarget === 'worker' && canChooseSendTarget(task.status) && (
          <div className="flex justify-end px-3 pbe-1">
            <select
              aria-label="Сессия воркера"
              title="Продолжить контекст этой задачи или начать с нуля"
              value={sessionMode}
              onChange={event => setSessionMode(event.target.value as WorkerSessionMode)}
              disabled={submitting}
              className="max-w-full rounded-lg bg-background px-2 py-1 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:bg-muted"
            >
              <option value="continue">Продолжить сессию</option>
              <option value="new">Новая сессия</option>
            </select>
          </div>
        )}

        {/* nowrap: кнопка отправки НЕ переносится на отдельную строку на узких экранах —
            левая группа (скрепка + «кому уведомить») сжимается, send всегда справа. */}
        {canReturn && (
          <label htmlFor={returnCheckboxId} className="flex min-h-9 w-fit cursor-pointer items-center gap-2 px-3.5 text-sm">
            <Checkbox
              id={returnCheckboxId}
              checked={returnChecked}
              onCheckedChange={(checked) => setReturnChecked(checked === true)}
              disabled={submitting}
            />
            Вернуть исполнителю
          </label>
        )}
        <div className="flex items-center gap-2 pbe-1.5 pbs-0.5 pe-1.5 ps-2">
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
              candidates={notifyCandidates.candidates}
              failed={notifyCandidates.failed}
              defaultAudience={defaultAudience}
              value={notify}
              onChange={setNotify}
              disabled={submitting}
            />
          </div>

          <div className="shrink-0">
            {!awaitingApproval && task.canEdit !== false && canChooseSendTarget(task.status) ? (
              <SendTargetButton
                size="lg"
                options={workerEnabled ? DRAWER_TARGETS : DRAWER_TARGETS_NO_WORKER}
                value={effectiveTarget}
                onChange={setTarget}
                onSend={() => void submit()}
                submitting={submitting}
                disabled={!canSubmit}
              />
            ) : (
              // «В работе» и кастомные колонки не двигаются от комментария — показываем
              // обычную кнопку отправки, без подписи цели, которая обещала бы перенос.
              <SendTargetButton
                size="lg"
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

      <AttachmentLightbox
        attachment={preview}
        onClose={() => setPreview(null)}
        attachActionLabel="Сохранить пометки"
        onAttachToDraft={
          preview
            ? (annotatedFile) => {
                const targetId = preview.id;
                const nextUrl = URL.createObjectURL(annotatedFile);
                updateCommentDraft(draftKey, (current) => ({
                  ...current,
                  files: current.files.map((entry) =>
                    entry.id === targetId
                      ? { id: crypto.randomUUID(), file: annotatedFile, previewUrl: nextUrl }
                      : entry,
                  ),
                }));
              }
            : undefined
        }
      />
    </div>
  );
}
