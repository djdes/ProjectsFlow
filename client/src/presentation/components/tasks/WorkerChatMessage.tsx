import { useState } from 'react';
import type { TaskComment } from '@/domain/task/TaskComment';
import { NEW_WORKER_SESSION_MARKER } from '@/domain/task/WorkerSessionMode';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { AttachmentLightbox } from '@/presentation/components/attachments/AttachmentLightbox';
import { isImageFile } from '@/presentation/components/attachments/files';
import { CommentBody } from './CommentBody';
import { CommentAcknowledgement } from './CommentAcknowledgement';

export function WorkerChatMessage({ comment, authorName, projectId }: { comment: TaskComment; authorName: string; projectId: string }): React.ReactElement {
  const { user } = useCurrentUser();
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const startsNewSession = comment.body.startsWith(NEW_WORKER_SESSION_MARKER);
  return <article data-worker-message={comment.id} className="ms-auto flex w-fit max-w-[92%] flex-col gap-2 rounded-xl border border-primary/20 bg-primary-soft px-3 py-2.5 text-sm [overflow-wrap:break-word]">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{comment.ownerUserId === user?.id ? 'Вы' : authorName}</span>
      <time dateTime={comment.createdAt.toISOString()}>{comment.createdAt.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
      {startsNewSession && <span>Новая сессия</span>}
    </div>
    <CommentBody body={startsNewSession ? comment.body.slice(NEW_WORKER_SESSION_MARKER.length).trimStart() : comment.body} />
    {comment.attachments.length > 0 && <div className="flex flex-wrap gap-2">{comment.attachments.map(attachment => isImageFile(attachment.mimeType, attachment.filename)
      ? <button type="button" key={attachment.id} aria-label={`Открыть ${attachment.filename}`} onClick={() => setPreview(attachment)} className="max-w-64 overflow-clip rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:opacity-80"><img src={attachment.url} alt={attachment.filename} loading="lazy" className="h-auto max-h-48 w-full object-contain" /></button>
      : <a key={attachment.id} href={attachment.url} download={attachment.filename} className="break-all underline">{attachment.filename}</a>)}</div>}
    <CommentAcknowledgement projectId={projectId} comment={comment} />
    <AttachmentLightbox attachment={preview} attachments={comment.attachments} onClose={() => setPreview(null)} />
  </article>;
}
