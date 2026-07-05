import { createHmac, timingSafeEqual } from 'node:crypto';

// Подписанный URL картинки-вложения. Письмо и Telegram НЕ авторизованы (нет сессии-cookie),
// а /api/attachments/:id закрыт requireAuth — поэтому обычная ссылка у них 401. Мы подписываем
// короткоживущий HMAC-токен (id + exp), эндпоинт его валидирует и отдаёт файл без сессии.
// Секрет общий с repo-access; неймспейс 'att' не даёт переиспользовать чужую подпись.

const NS = 'att';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(id: string, exp: number, secret: string): string {
  return b64url(createHmac('sha256', secret).update(`${NS}:${id}:${exp}`).digest());
}

// id вложения из src вида '/api/attachments/<id>' (возможно с хостом/квери). null — не наш URL.
export function attachmentIdFromSrc(src: string): string | null {
  const m = /\/api\/attachments\/([A-Za-z0-9._-]+)/.exec(src);
  return m ? m[1]! : null;
}

// Подписанный абсолютный URL картинки для письма/Telegram. rawSrc — '/api/attachments/<id>'.
// null, если rawSrc не наш attachment-URL (тогда caller картинку не вставляет).
export function signAttachmentUrl(
  baseUrl: string,
  rawSrc: string,
  secret: string,
  ttlSeconds: number,
  now: number,
): string | null {
  const id = attachmentIdFromSrc(rawSrc);
  if (!id) return null;
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = sign(id, exp, secret);
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/attachments/${encodeURIComponent(id)}?e=${exp}&s=${sig}`;
}

// Проверка токена на эндпоинте: подпись верна И срок не истёк. timingSafeEqual — анти-timing.
export function verifyAttachmentToken(
  id: string,
  exp: string,
  sig: string,
  secret: string,
  now: number,
): boolean {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum * 1000 < now) return false;
  const expected = Buffer.from(sign(id, expNum, secret));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// Резолвер для markdownToRich (email): '/api/attachments/<id>' → подписанный абсолютный URL.
export function makeAttachmentImageResolver(
  baseUrl: string,
  secret: string,
  ttlSeconds: number,
  now: number,
): (rawSrc: string) => string | null {
  return (rawSrc: string) => signAttachmentUrl(baseUrl, rawSrc, secret, ttlSeconds, now);
}
