import { useState } from 'react';
import type { TaskComment } from '@/domain/task/TaskComment';
import { NEW_WORKER_SESSION_MARKER } from '@/domain/task/WorkerSessionMode';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { CommentBody } from './CommentBody';
import { CommentAcknowledgement } from './CommentAcknowledgement';
import { CommentAttachments } from './CommentAttachments';
import { appendCommentDraftFiles, commentDraftKey } from './commentDraft';

export function WorkerChatMessage({ comment, authorName, projectId }: { comment: TaskComment; authorName: string; projectId: string }): React.ReactElement {
  const { user } = useCurrentUser();
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const startsNewSession = comment.body.startsWith(NEW_WORKER_SESSION_MARKER);
  return <article data-worker-message={comment.id} className="ms-auto flex w-fit max-w-[92%] flex-col gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5 text-sm [overflow-wrap:break-word]">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{comment.ownerUserId === user?.id ? 'Вы' : authorName}</span>
      <time dateTime={comment.createdAt.toISOString()}>{comment.createdAt.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
      {startsNewSession && <span>Новая сессия</span>}
    </div>
    <CommentBody body={startsNewSession ? comment.body.slice(NEW_WORKER_SESSION_MARKER.length).trimStart() : comment.body} />
    <CommentAttachments attachments={comment.attachments} onPreview={setPreview} className="mbs-0" />
    <CommentAcknowledgement projectId={projectId} comment={comment} />
    <AttachmentLightbox
      attachment={preview}
      attachments={comment.attachments}
      onClose={() => setPreview(null)}
      onAttachToDraft={
        user
          ? (annotatedFile) =>
              appendCommentDraftFiles(
                commentDraftKey(user.id, projectId, comment.taskId),
                [annotatedFile],
              )
          : undefined
      }
    />
  </article>;
}
