// Letter designs (db/177). 'standard' is the classic notification-style card; the others are
// promo layouts with a raster hero and an offer field under it. The hero art never carries
// the offer: the offer, the headline and the buttons stay live HTML text.

export const MAILING_LAYOUTS = ['standard', 'trial', 'annual', 'winback', 'referral', 'deadline', 'news'] as const;
export type MailingLayout = (typeof MAILING_LAYOUTS)[number];

export function isMailingLayout(value: unknown): value is MailingLayout {
  return typeof value === 'string' && (MAILING_LAYOUTS as readonly string[]).includes(value);
}

/**
 * Editable promo terms shown in the offer field under the hero and available in texts as {{offer}} and
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
  // Optional price line under the badge. «X вместо Y» shows Y crossed out (anchoring, only for
  // a real discount); anything else is shown as is, e.g. «0 ₽ — без карты».
  readonly price?: string;
};

export const MAILING_OFFER_LIMITS = { badge: 40, deadline: 60, caption: 40, price: 60 } as const;

/** «15 960 ₽ вместо 22 800 ₽» → now/was; null when the line is not a comparison. */
export function splitOfferPrice(price: string): { readonly now: string; readonly was: string } | null {
  const m = /^(.+?)\s+вместо\s+(.+)$/iu.exec(price.trim());
  return m ? { now: m[1]!, was: m[2]! } : null;
}

/** Normalizes stored or submitted offer JSON; empty offers become null. */
export function parseMailingOffer(raw: unknown): MailingOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const badge = text(v['badge'], MAILING_OFFER_LIMITS.badge);
  const deadline = text(v['deadline'], MAILING_OFFER_LIMITS.deadline);
  const caption = text(v['caption'], MAILING_OFFER_LIMITS.caption);
  const price = text(v['price'], MAILING_OFFER_LIMITS.price);
  if (!badge && !deadline) return null;
  return { badge, deadline, ...(caption ? { caption } : {}), ...(price ? { price } : {}) };
}
