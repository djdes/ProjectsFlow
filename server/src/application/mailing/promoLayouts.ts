import type { MailingBodyTheme } from '../../domain/mailing/renderMailingBody.js';
import type { MailingLayout } from '../../domain/mailing/layouts.js';

// Visual themes of the promo letters. One family: hairline rules, spaced lowercase labels,
// web-safe serif (Georgia) or wide grotesk (Arial Black) display type, a raster hero with
// the art. Each layout mixes at least two of the four art references:
//   trial    — stipple sphere in a star field + glossy green glass orbit
//   annual   — ultramarine halftone clouds and rays + engraved cross flare, two shades only
//   winback  — torn-paper collage with moon phases + stipple-engraved moon and night sky
//   referral — Japanese minimal grid, spheres on threads, glitch smear + one glass sphere
//   deadline — halftone ultramarine sun + glitch stretch bars under a ticked horizon
//   news     — black-ink stipple planet with a tiny figure + glass ring + leader lines
//
// The offer is the hero of every promo letter: a solid colour field right under the art
// (hero-2 ends in that very colour — the torn sheet, the halftone fade, the mint horizon —
// so the field reads as part of the picture), holding the deadline chip, a huge badge, the
// price line and the primary button. The art itself carries no terms, numbers or clocks:
// any layout may carry any offer.

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const WIDE = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif";

export type PromoOfferStyle =
  // chip, caption, big badge, price, button — one column
  | 'stacked'
  // big badge left, caption and price right of a hairline (stacks on phones)
  | 'split';

type Ink = { readonly bg: string; readonly ink: string };

export type PromoTheme = {
  readonly hero: { readonly file: string; readonly width: number; readonly height: number; readonly alt: string; readonly bg: string; readonly altInk: string };
  readonly page: string;
  readonly card: string;
  readonly border: string;
  readonly rule: string;
  readonly label: string;
  readonly body: MailingBodyTheme;
  readonly h1Phone: number;
  readonly offer: {
    readonly style: PromoOfferStyle;
    // Default small line next to the badge when the template has no caption of its own.
    readonly caption: string;
    readonly font: string;
    readonly weight: number;
    readonly italic: boolean;
    // The field: background, badge colour, caption/price colour, split hairline.
    readonly field: string;
    readonly ink: string;
    readonly sub: string;
    readonly rule: string;
    readonly chip: Ink & { readonly radius: number };
    // Only the «Закат» layout may put a last-day deadline above the badge as a ribbon.
    readonly ribbon?: Ink;
    // The primary button inside the field.
    readonly button: Ink;
  };
  // The repeated button after the body text, on the card colour.
  readonly cta: {
    readonly bg: string;
    readonly ink: string;
    readonly border: string;
    readonly radius: number;
    readonly font: string;
    readonly weight: number;
    readonly spacing: string;
    readonly uppercase: boolean;
  };
  readonly footer: { readonly ink: string; readonly link: string };
};

export type PromoLayout = Exclude<MailingLayout, 'standard'>;

export const PROMO_THEMES: Readonly<Record<PromoLayout, PromoTheme>> = {
  trial: {
    hero: { file: 'hero-2.png', width: 600, height: 400, bg: '#000000', altInk: '#d9d9d9',
      alt: 'Светящаяся сфера в звёздном небе, вокруг неё — зелёная стеклянная орбита' },
    page: '#1b1b1b', card: '#000000', border: '#2b2b2b', rule: '#2b2b2b', label: '#8f8f8f',
    body: { text: '#d4d4d4', heading: '#ffffff', link: '#9fe3b8', quote: '#bdbdbd', quoteBorder: '#3f8a5e', rule: '#2b2b2b', codeBg: '#1a1a1a',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 36 },
    h1Phone: 29,
    offer: { style: 'stacked', caption: 'Прайм бесплатно', font: SERIF, weight: 400, italic: true,
      field: '#9fe3b8', ink: '#000000', sub: '#0d2a19', rule: '#0d2a19',
      chip: { bg: '#000000', ink: '#9fe3b8', radius: 999 }, button: { bg: '#000000', ink: '#ffffff' } },
    cta: { bg: '#9fe3b8', ink: '#000000', border: '#cff5dc', radius: 999, font: SANS, weight: 700, spacing: '0.2px', uppercase: false },
    footer: { ink: '#7a7a7a', link: '#b5b5b5' },
  },
  annual: {
    hero: { file: 'hero-2.png', width: 600, height: 380, bg: '#1e2196', altInk: '#eef0ff',
      alt: 'Ультрамариновое небо в полутоне: облака и лучи солнца' },
    page: '#d9dbf5', card: '#eef0ff', border: '#1e2196', rule: '#1e2196', label: '#1e2196',
    body: { text: '#1e2196', heading: '#1e2196', link: '#1e2196', quote: '#1e2196', quoteBorder: '#1e2196', rule: '#1e2196', codeBg: '#dfe1fb',
      font: SANS, headingFont: WIDE, headingWeight: 900, headingTransform: 'uppercase', headingSpacing: '0.5px', h1Size: 28 },
    h1Phone: 23,
    offer: { style: 'split', caption: 'на годовой тариф', font: WIDE, weight: 900, italic: false,
      field: '#1e2196', ink: '#ffffff', sub: '#e4e6fd', rule: '#8f93e3',
      chip: { bg: '#eef0ff', ink: '#1e2196', radius: 0 }, button: { bg: '#eef0ff', ink: '#1e2196' } },
    cta: { bg: '#1e2196', ink: '#eef0ff', border: '#1e2196', radius: 0, font: WIDE, weight: 900, spacing: '1.5px', uppercase: true },
    footer: { ink: '#1e2196', link: '#1e2196' },
  },
  winback: {
    hero: { file: 'hero-2.png', width: 600, height: 380, bg: '#e6e5e1', altInk: '#262624',
      alt: 'Коллаж из рваной бумаги: луна, ночное небо и фазы луны' },
    page: '#d6d5d1', card: '#e6e5e1', border: '#c4c2bd', rule: '#262624', label: '#4a4945',
    body: { text: '#262624', heading: '#000000', link: '#000000', quote: '#4a4945', quoteBorder: '#24432f', rule: '#a19f9a', codeBg: '#d8d7d3',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 36 },
    h1Phone: 29,
    offer: { style: 'stacked', caption: 'в подарок', font: SERIF, weight: 400, italic: true,
      field: '#000000', ink: '#ffffff', sub: '#d6d5d1', rule: '#77756f',
      chip: { bg: '#b9c9bd', ink: '#0b0f0c', radius: 999 }, button: { bg: '#e6e5e1', ink: '#000000' } },
    cta: { bg: '#000000', ink: '#e6e5e1', border: '#000000', radius: 999, font: SANS, weight: 700, spacing: '0.2px', uppercase: false },
    footer: { ink: '#5e5d59', link: '#262624' },
  },
  referral: {
    hero: { file: 'hero-2.png', width: 600, height: 380, bg: '#e3e4e0', altInk: '#123821',
      alt: 'Тёмно-зелёные шары на нитях и один стеклянный — команда на одной линии' },
    page: '#d4d5d1', card: '#e3e4e0', border: '#b5b6b2', rule: '#123821', label: '#3f403d',
    body: { text: '#1f2a22', heading: '#123821', link: '#1d5a33', quote: '#3f403d', quoteBorder: '#2f7a47', rule: '#b5b6b2', codeBg: '#d4d5d1',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 34 },
    h1Phone: 27,
    offer: { style: 'split', caption: 'за приглашение', font: SERIF, weight: 400, italic: false,
      field: '#123821', ink: '#ffffff', sub: '#d3e6d9', rule: '#5aa06c',
      chip: { bg: '#bfeccc', ink: '#0a2214', radius: 0 }, button: { bg: '#bfeccc', ink: '#0a2214' } },
    cta: { bg: '#123821', ink: '#e3e4e0', border: '#123821', radius: 0, font: SANS, weight: 700, spacing: '0.4px', uppercase: false },
    footer: { ink: '#5b5c58', link: '#123821' },
  },
  deadline: {
    hero: { file: 'hero-2.png', width: 600, height: 340, bg: '#ebeae6', altInk: '#1e2196',
      alt: 'Полутоновое синее солнце садится за горизонт и рассыпается на полосы' },
    page: '#dad9d5', card: '#ebeae6', border: '#a9a8a4', rule: '#000000', label: '#55544f',
    body: { text: '#222220', heading: '#000000', link: '#1e2196', quote: '#55544f', quoteBorder: '#1e2196', rule: '#a9a8a4', codeBg: '#dad9d5',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 34 },
    h1Phone: 27,
    offer: { style: 'stacked', caption: 'акция', font: WIDE, weight: 900, italic: false,
      field: '#1e2196', ink: '#ffffff', sub: '#e4e6fd', rule: '#8f93e3',
      chip: { bg: '#ebeae6', ink: '#1e2196', radius: 0 }, ribbon: { bg: '#000000', ink: '#ffffff' }, button: { bg: '#ffffff', ink: '#1e2196' } },
    cta: { bg: '#1e2196', ink: '#ffffff', border: '#1e2196', radius: 0, font: WIDE, weight: 900, spacing: '1.5px', uppercase: true },
    footer: { ink: '#5e5d59', link: '#1e2196' },
  },
  news: {
    hero: { file: 'hero-2.png', width: 600, height: 390, bg: '#e8e7e3', altInk: '#262624',
      alt: 'Гравюра планеты с кольцом и человеком на вершине, подписи: канбан, входящие, воркер, Telegram' },
    page: '#d6d5d1', card: '#e8e7e3', border: '#b9b8b4', rule: '#000000', label: '#55544f',
    body: { text: '#262624', heading: '#000000', link: '#245c3c', quote: '#55544f', quoteBorder: '#3f8a5e', rule: '#b9b8b4', codeBg: '#d6d5d1',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 34 },
    h1Phone: 27,
    offer: { style: 'stacked', caption: 'бонус к обновлению', font: SERIF, weight: 400, italic: true,
      field: '#cff5dc', ink: '#0a2214', sub: '#123a24', rule: '#3f8a5e',
      chip: { bg: '#123a24', ink: '#cff5dc', radius: 999 }, button: { bg: '#000000', ink: '#ffffff' } },
    cta: { bg: '#000000', ink: '#e8e7e3', border: '#000000', radius: 999, font: SANS, weight: 700, spacing: '0.2px', uppercase: false },
    footer: { ink: '#5e5d59', link: '#262624' },
  },
};

/** Absolute URL of a layout's hero; the PNGs ship in client/public/mail/<layout>/. */
export function promoHeroUrl(assetBaseUrl: string, layout: PromoLayout): string {
  return `${assetBaseUrl.replace(/\/+$/, '')}/mail/${layout}/${PROMO_THEMES[layout].hero.file}`;
}

// A deadline that is itself the news: «сегодня до 23:59», «до завтра», «последний день».
const LAST_DAY_RE = /сегодня|завтра|последн|полуноч|\d{1,2}:\d{2}/iu;

/**
 * The badge is always the biggest line. Only a layout with a ribbon («Закат») and a deadline
 * that reads as the last day lifts the date into a ribbon above it; an ordinary «до 20 декабря»
 * stays a chip whatever the layout.
 */
export function isLastDayDeadline(theme: PromoTheme, deadline: string): boolean {
  return Boolean(theme.offer.ribbon) && LAST_DAY_RE.test(deadline);
}

export type PromoBadgeTier = 'l' | 'm' | 's' | 'xs';

const BADGE_SIZES: Readonly<Record<PromoBadgeTier, readonly [desktop: number, phone: number]>> = {
  l: [104, 76], m: [84, 60], s: [60, 44], xs: [44, 34],
};

/** Display size of the badge, by length: short offers get the poster treatment. */
export function promoBadgeSize(theme: PromoTheme, badge: string): { readonly desktop: number; readonly phone: number; readonly tier: PromoBadgeTier } {
  const len = [...badge].length;
  const tier: PromoBadgeTier = len <= 5 ? 'l' : len <= 9 ? 'm' : len <= 14 ? 's' : 'xs';
  const [desktop, phone] = BADGE_SIZES[tier];
  // Arial Black is about a fifth wider than Georgia.
  const k = theme.offer.font === WIDE ? 0.82 : 1;
  return { desktop: Math.round(desktop * k), phone: Math.round(phone * k), tier };
}

/** Phone sizes of every tier for the media query (the tier class sits on the badge). */
export function promoBadgePhoneSizes(theme: PromoTheme): ReadonlyArray<readonly [PromoBadgeTier, number]> {
  const k = theme.offer.font === WIDE ? 0.82 : 1;
  return (Object.keys(BADGE_SIZES) as PromoBadgeTier[]).map((tier) => [tier, Math.round(BADGE_SIZES[tier][1] * k)] as const);
}
