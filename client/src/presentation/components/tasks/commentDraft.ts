import type { NotifyAudience } from '@/domain/task/TaskComment';

export type CommentReplyDraft = {
  readonly commentId: string;
  readonly authorName: string;
  readonly quotedText: string | null;
};

export type CommentDraftFile = {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
};

export type CommentDraft = {
  readonly body: string;
  readonly bodyRevision: number;
  readonly notify: NotifyAudience | null;
  readonly reply: CommentReplyDraft | null;
  // Files and the send lock survive closing the drawer within this tab.
  readonly files: readonly CommentDraftFile[];
  readonly sending: boolean;
};

const drafts = new Map<string, CommentDraft>();
const listeners = new Map<string, Set<() => void>>();
const empty: CommentDraft = {
  body: '', bodyRevision: 0, notify: null, reply: null, files: [], sending: false,
};

export function commentDraftKey(userId: string, projectId: string, taskId: string): string {
  return 'pf.commentDraft.v1.' + JSON.stringify([userId, projectId, taskId]);
}

function audience(value: unknown): NotifyAudience | null {
  if (!value || typeof value !== 'object' || !('mode' in value)) return null;
  if (value.mode === 'all' || value.mode === 'none') return { mode: value.mode };
  if (value.mode === 'selected' && 'userIds' in value && Array.isArray(value.userIds) &&
      value.userIds.every((id) => typeof id === 'string')) {
    const userIds = [...new Set<string>(value.userIds)];
    return userIds.length ? { mode: 'selected', userIds } : { mode: 'none' };
  }
  return null;
}

export function readCommentDraft(key: string): CommentDraft {
  const cached = drafts.get(key);
  if (cached) return cached;
  let draft = empty;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    if (raw && typeof raw === 'object' && 'body' in raw && typeof raw.body === 'string') {
      let reply: CommentReplyDraft | null = null;
      if ('reply' in raw && raw.reply && typeof raw.reply === 'object' &&
          'commentId' in raw.reply && typeof raw.reply.commentId === 'string' &&
          'authorName' in raw.reply && typeof raw.reply.authorName === 'string' &&
          'quotedText' in raw.reply && (raw.reply.quotedText === null || typeof raw.reply.quotedText === 'string')) {
        reply = { commentId: raw.reply.commentId, authorName: raw.reply.authorName, quotedText: raw.reply.quotedText };
      }
      draft = { ...empty, body: raw.body, notify: audience('notify' in raw ? raw.notify : null), reply };
    }
  } catch { /* Storage may be blocked, full, or contain an invalid draft. */ }
  drafts.set(key, draft);
  return draft;
}

export function subscribeCommentDraft(key: string, listener: () => void): () => void {
  const group = listeners.get(key) ?? new Set();
  group.add(listener);
  listeners.set(key, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(key);
  };
}

export function updateCommentDraft(
  key: string,
  change: (current: CommentDraft) => CommentDraft,
): void {
  const before = readCommentDraft(key);
  const next = change(before);
  if (next === before) return;
  const draft = { ...next, bodyRevision: before.bodyRevision + Number(next.body !== before.body) };
  drafts.set(key, draft);
  // Persist on each edit, before a drawer unmount or page navigation can discard it.
  try {
    if (draft.body || draft.reply || draft.notify) {
      window.localStorage.setItem(key, JSON.stringify({ body: draft.body, notify: draft.notify, reply: draft.reply }));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch { /* In-memory drafts still work if browser storage is unavailable. */ }
  for (const file of before.files) {
    if (file.previewUrl && !draft.files.some((entry) => entry.id === file.id)) URL.revokeObjectURL(file.previewUrl);
  }
  listeners.get(key)?.forEach((listener) => listener());
}

/** The lock belongs to the draft, so reopening a sending task cannot submit it twice. */
export function beginCommentSend(key: string): CommentDraft | null {
  const draft = readCommentDraft(key);
  if (draft.sending || (!draft.body.trim() && !draft.files.length)) return null;
  updateCommentDraft(key, (current) => ({ ...current, sending: true }));
  return draft;
}

/** A late response must not erase text entered after the submitted snapshot. */
export function acknowledgeComment(key: string, sent: CommentDraft): void {
  updateCommentDraft(key, (current) => ({
    ...current,
    ...(current.bodyRevision === sent.bodyRevision ? { body: '' } : {}),
    ...(current.reply === sent.reply ? { reply: null } : {}),
    // Keep an explicit recipient choice for the next comment in this task.
  }));
}
