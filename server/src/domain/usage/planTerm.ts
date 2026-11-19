import type { PlanId } from './Plan.js';
import { isActive, type Subscription } from './Subscription.js';

// How an admin grants a paid plan to many users at once.
export type PlanTerm =
  | { readonly kind: 'extend'; readonly days: number }
  | { readonly kind: 'until'; readonly date: Date }
  | { readonly kind: 'unlimited' };

// TIMESTAMP columns end on 2038-01-19.
export const PLAN_TERM_MAX = new Date('2038-01-19T03:14:07Z');
const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidPlanTerm(term: PlanTerm, now: Date): boolean {
  if (term.kind === 'extend') return Number.isInteger(term.days) && term.days >= 1 && term.days <= 3650;
  if (term.kind === 'until') {
    const t = term.date.getTime();
    return Number.isFinite(t) && t > now.getTime() && t <= PLAN_TERM_MAX.getTime();
  }
  return true;
}

/**
 * The subscription after the grant. «Extend» adds days to a running term of the same plan,
 * otherwise counts from now; a running unlimited grant of the same plan stays unlimited.
 * The start date survives when the plan does not change.
 */
export function applyPlanTerm(current: Subscription, plan: Exclude<PlanId, 'free'>, term: PlanTerm, now: Date): Subscription {
  const samePlanRunning = current.plan === plan && isActive(current, now);
  const startedAt = samePlanRunning ? (current.startedAt ?? now) : now;
  if (term.kind === 'unlimited') return { plan, startedAt, expiresAt: null };
  if (term.kind === 'until') return { plan, startedAt, expiresAt: term.date };
  if (samePlanRunning && current.expiresAt === null) return { plan, startedAt, expiresAt: null };
  const base = samePlanRunning && current.expiresAt ? current.expiresAt.getTime() : now.getTime();
  const expiresAt = new Date(Math.min(base + term.days * DAY_MS, PLAN_TERM_MAX.getTime()));
  return { plan, startedAt, expiresAt };
}
