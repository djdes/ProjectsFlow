import { createHmac, timingSafeEqual } from 'node:crypto';

// Stateless unsubscribe token `<userId>.<sig>`: HMAC-SHA256 over a namespaced user id,
// base64url, cut to 22 chars (132 bits) to keep links short. Forged or truncated tokens
// are rejected without touching the database. Not secret-free: whoever holds the link
// can unsubscribe that user, which is exactly what the link in their letter is for.
const NS = 'pf-mailing-unsubscribe:';
const SIG_LENGTH = 22;
const USER_ID_RE = /^[\w-]{1,64}$/;

function sign(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${NS}${userId}`).digest('base64url').slice(0, SIG_LENGTH);
}

export function createUnsubscribeToken(userId: string, secret: string): string {
  if (!USER_ID_RE.test(userId)) throw new Error('invalid user id for unsubscribe token');
  return `${userId}.${sign(userId, secret)}`;
}

/** Returns the user id when the token is authentic, otherwise null. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!USER_ID_RE.test(userId) || sig.length !== SIG_LENGTH) return null;
  const expected = Buffer.from(sign(userId, secret));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? userId : null;
}
