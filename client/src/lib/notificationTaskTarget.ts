export function notificationTaskTarget(payload: {
  projectId?: string; taskId?: string; commentId?: string; taskAvailable?: boolean;
}): string | null {
  if (payload.taskAvailable === false || !payload.projectId || !payload.taskId) return null;
  return `/projects/${encodeURIComponent(payload.projectId)}/tasks/${encodeURIComponent(payload.taskId)}` +
    (payload.commentId ? `#comment-${encodeURIComponent(payload.commentId)}` : '');
}

export function taskCommentFromHash(hash: string): string | undefined {
  if (!hash.startsWith('#comment-')) return undefined;
  try { return decodeURIComponent(hash.slice(9)) || undefined; } catch { return undefined; }
}
