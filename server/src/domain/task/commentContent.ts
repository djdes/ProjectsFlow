// A comment may consist of attachments only (a screenshot without text). The body is then
// empty, and every place that previews the comment as text shows this label instead.
export const ATTACHMENT_ONLY_COMMENT_PREVIEW = '📎 Вложение';

/** A comment needs text or at least one attachment. */
export function hasCommentContent(body: string, attachmentCount: number): boolean {
  return body.trim().length > 0 || attachmentCount > 0;
}

/** Text used to preview a comment in notifications, feeds and lists. */
export function commentPreviewText(body: string): string {
  return body.trim().length > 0 ? body : ATTACHMENT_ONLY_COMMENT_PREVIEW;
}
