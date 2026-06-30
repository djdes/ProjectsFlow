import type { PlanId } from './Plan.js';

export type Subscription = {
  readonly plan: PlanId;
  readonly startedAt: Date | null;
  readonly expiresAt: Date | null;
};

// Активна, если план платный и срок не истёк (null expiresAt = бессрочно / до отмены).
export function isActive(sub: Subscription, now: Date): boolean {
  if (sub.plan === 'free') return false;
  if (sub.expiresAt && sub.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

// Эффективный план для лимитов: истёкший prime/vip трактуется как free (ленивый demote).
export function effectivePlan(sub: Subscription, now: Date): PlanId {
  return isActive(sub, now) ? sub.plan : 'free';
}
