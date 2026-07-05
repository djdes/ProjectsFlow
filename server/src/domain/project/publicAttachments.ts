// Переписывание ссылок на вложения в теле задачи/коммента с authed-роута на публичный —
// чтобы аноним мог загрузить картинки опубликованной доски (Publish to web). Тело содержит
// `<figure data-figure-image><img src="/api/attachments/<id>"></figure>`; authed-роут
// /api/attachments/:id требует сессию, поэтому для публичной выдачи переписываем на
// /api/public/boards/<slug>/attachments/<id> (гейт по is_public, без membership). См. db/096.
export function rewriteAttachmentUrls(body: string, slug: string): string {
  return body.replace(
    /\/api\/attachments\/([a-f0-9-]+)/gi,
    (_full, id: string) => `/api/public/boards/${slug}/attachments/${id}`,
  );
}
