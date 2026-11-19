import type { MailingAudience, MailingCandidate, MailingPlan } from './Mailing.js';
import { MAILING_PLANS, MAILING_USERS_AUDIENCE_MAX } from './Mailing.js';

export type MailingReach = {
  // Will receive the letter.
  readonly eligible: number;
  // Matched the audience but unsubscribed earlier.
  readonly unsubscribed: number;
  // Matched the audience but have no usable address or share one with another account.
  readonly invalid: number;
};

export type SelectedAudience = {
  readonly recipients: readonly MailingCandidate[];
  readonly reach: MailingReach;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Applies the unsubscribe list and address checks to the users matched by an audience.
 * One letter per address: the first account wins, later duplicates count as invalid.
 * Order is stable (input order) so the queue goes out predictably.
 */
export function selectMailingRecipients(
  candidates: readonly MailingCandidate[],
  unsubscribedUserIds: ReadonlySet<string>,
): SelectedAudience {
  const seenUsers = new Set<string>();
  const seenEmails = new Set<string>();
  const recipients: MailingCandidate[] = [];
  let unsubscribed = 0;
  let invalid = 0;
  for (const c of candidates) {
    if (seenUsers.has(c.userId)) continue;
    seenUsers.add(c.userId);
    if (unsubscribedUserIds.has(c.userId)) { unsubscribed++; continue; }
    const email = c.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seenEmails.has(email)) { invalid++; continue; }
    seenEmails.add(email);
    recipients.push({ ...c, email: c.email.trim() });
  }
  return { recipients, reach: { eligible: recipients.length, unsubscribed, invalid } };
}

/** Validates an audience coming from the client; null when it is malformed. */
export function parseMailingAudience(raw: unknown): MailingAudience | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { kind?: unknown; workspaceId?: unknown; plans?: unknown; userIds?: unknown };
  if (value.kind === 'all') return { kind: 'all' };
  if (value.kind === 'workspace') {
    return typeof value.workspaceId === 'string' && /^[\w-]{1,64}$/.test(value.workspaceId)
      ? { kind: 'workspace', workspaceId: value.workspaceId }
      : null;
  }
  if (value.kind === 'users') {
    if (!Array.isArray(value.userIds)) return null;
    const ids = value.userIds as unknown[];
    const valid = ids.every((id) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id));
    return valid && ids.length > 0 && ids.length <= MAILING_USERS_AUDIENCE_MAX && new Set(ids).size === ids.length
      ? { kind: 'users', userIds: ids as string[] }
      : null;
  }
  if (value.kind === 'plan') {
    if (!Array.isArray(value.plans)) return null;
    const plans = MAILING_PLANS.filter((p) => (value.plans as unknown[]).includes(p));
    return plans.length > 0 && plans.length === new Set(value.plans).size
      ? { kind: 'plan', plans: plans as MailingPlan[] }
      : null;
  }
  return null;
}

/**
 * Effective plan as the app sees it: a lapsed prime/vip subscription reads as free;
 * no expiry date means an unlimited grant.
 */
export function effectiveMailingPlan(plan: MailingPlan, expiresAt: Date | null, now: Date): MailingPlan {
  if (plan === 'free') return 'free';
  return expiresAt === null || expiresAt.getTime() > now.getTime() ? plan : 'free';
}
