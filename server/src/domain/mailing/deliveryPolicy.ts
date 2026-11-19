// Sending policy of the mailing queue. Both reference implementations agree on
// at-most-once delivery: a recipient left in `sending` (process died mid-send) is marked
// failed and never retried automatically; only a send that clearly did not happen is.

export const MAILING_MAX_ATTEMPTS = 3;
export const MAILING_RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000];
// A claim older than this belongs to a process that is gone.
export const MAILING_STALE_CLAIM_MS = 10 * 60_000;
export const MAILING_DEFAULT_PER_MINUTE = 20;
export const MAILING_MAX_PER_MINUTE = 600;

export type MailingSendOutcome =
  | { readonly kind: 'retry'; readonly at: Date; readonly error: string }
  | { readonly kind: 'failed'; readonly error: string };

/** SMTP 5xx is a permanent rejection (bad mailbox, policy); anything else may pass later. */
export function isPermanentSendError(error: unknown): boolean {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
}

export function describeSendError(error: unknown): string {
  const e = error as { responseCode?: unknown; code?: unknown; message?: unknown } | null;
  const parts = [
    typeof e?.responseCode === 'number' ? String(e.responseCode) : null,
    typeof e?.code === 'string' ? e.code : null,
    typeof e?.message === 'string' ? e.message : null,
  ].filter(Boolean);
  return (parts.join(' ') || 'send failed').slice(0, 250);
}

/** What happens to a recipient after the attempt number `attempts` (1-based) threw. */
export function mailingSendFailure(error: unknown, attempts: number, now: Date): MailingSendOutcome {
  const description = describeSendError(error);
  const delay = MAILING_RETRY_DELAYS_MS[attempts - 1];
  if (isPermanentSendError(error) || attempts >= MAILING_MAX_ATTEMPTS || delay === undefined) {
    return { kind: 'failed', error: description };
  }
  return { kind: 'retry', at: new Date(now.getTime() + delay), error: description };
}

/** Letters still allowed this minute; the minute is rolling and counts claims in flight. */
export function mailingBudget(perMinute: number, sentLastMinute: number): number {
  return Math.max(0, perMinute - sentLastMinute);
}

export function parsePerMinute(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return MAILING_DEFAULT_PER_MINUTE;
  return Math.min(Math.floor(n), MAILING_MAX_PER_MINUTE);
}
