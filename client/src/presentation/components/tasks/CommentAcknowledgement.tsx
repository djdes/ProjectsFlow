import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import type { TaskComment } from '@/domain/task/TaskComment';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useAwaitingReply } from '@/presentation/hooks/AwaitingReplyProvider';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

const EMPTY: NonNullable<TaskComment['acknowledgements']> = [];

export function CommentAcknowledgement({ projectId, comment }: {
  projectId: string;
  comment: TaskComment;
}): React.ReactElement | null {
  const { user } = useCurrentUser();
  const { taskRepository } = useContainer();
  const { refresh } = useAwaitingReply();
  const [accepted, setAccepted] = useState(comment.acknowledgements ?? EMPTY);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => { setAccepted(comment.acknowledgements ?? EMPTY); }, [comment.id, comment.acknowledgements]);

  const mine = accepted.some(a => a.userId === user?.id);
  const canAccept = !!user && comment.ownerUserId !== user.id && comment.actorKind !== 'system';
  const toggle = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const result = await taskRepository.setCommentAcknowledged(projectId, comment.taskId, comment.id, !mine);
      setAccepted(result);
      refresh();
    } catch {
      toast.error('Не удалось сохранить отметку. Попробуйте ещё раз.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  if (!canAccept && !accepted.length) return null;
  return <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Подтверждение комментария">
    {canAccept && <Button type="button" variant="ghost" size="sm" disabled={pending}
      aria-pressed={mine} aria-busy={pending}
      title={mine ? 'Снять свою отметку «Принято»' : 'Подтвердить, что комментарий принят'}
      onClick={() => void toggle()}
      className="h-auto min-h-9 shrink-0 gap-1.5 px-2 py-1 text-xs active:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-done-soft aria-pressed:text-done-ink">
      {pending ? <Loader2 aria-hidden className="size-[1em] motion-safe:animate-spin" /> : <CheckCheck aria-hidden className="size-[1em]" />}
      {pending ? 'Сохраняю…' : mine ? 'Принято' : 'Принять'}
    </Button>}
    {accepted.length > 0 && <span className="min-w-0 break-words text-muted-foreground" role="status">
      Приняли: {accepted.map(a => a.userId === user?.id ? 'вы' : a.displayName || 'Без имени').join(', ')}
    </span>}
  </div>;
}
