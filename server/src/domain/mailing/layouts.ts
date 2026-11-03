// Letter designs (db/177). 'standard' is the classic notification-style card; the others are
// promo layouts with a raster hero and an offer strip. The hero art never carries the offer:
// the offer, the headline and the button stay live HTML text.

export const MAILING_LAYOUTS = ['standard', 'trial', 'annual', 'winback', 'referral', 'deadline', 'news'] as const;
export type MailingLayout = (typeof MAILING_LAYOUTS)[number];

export function isMailingLayout(value: unknown): value is MailingLayout {
  return typeof value === 'string' && (MAILING_LAYOUTS as readonly string[]).includes(value);
}

/**
 * Editable promo terms shown in the offer strip and available in texts as {{offer}} and
 * {{deadline}}. Nothing here is enforced by billing: plans are granted by an admin.
 */
export type MailingOffer = {
  // Short, e.g. «7 дней», «−30%», «+1 месяц».
  readonly badge: string;
  // Free text, e.g. «до 30 ноября».
  readonly deadline: string;
  // Small label over the badge, e.g. «на тариф VIP». Absent — the layout's own caption, which
  // fits its original promo («на годовой тариф») but not a letter reusing the design.
  readonly caption?: string;
};

export const MAILING_OFFER_LIMITS = { badge: 40, deadline: 60, caption: 40 } as const;

/** Normalizes stored or submitted offer JSON; empty offers become null. */
export function parseMailingOffer(raw: unknown): MailingOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const badge = text(v['badge'], MAILING_OFFER_LIMITS.badge);
  const deadline = text(v['deadline'], MAILING_OFFER_LIMITS.deadline);
  const caption = text(v['caption'], MAILING_OFFER_LIMITS.caption);
  if (!badge && !deadline) return null;
  return caption ? { badge, deadline, caption } : { badge, deadline };
}
