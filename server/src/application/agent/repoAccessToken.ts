import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeGitUrl } from '../project/gitUrl.js';

// Непрозрачный requestTarget: HMAC-SHA256(secret, нормализованный URL) в hex.
// Детерминированный, не раскрывает проект/владельца, проверяется сервером без хранения.
export function makeRequestTarget(gitRepoUrl: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizeGitUrl(gitRepoUrl)).digest('hex');
}

export function verifyRequestTarget(token: string, gitRepoUrl: string, secret: string): boolean {
  const expected = makeRequestTarget(gitRepoUrl, secret);
  // timing-safe сравнение фикс. длины hex-строк.
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}
