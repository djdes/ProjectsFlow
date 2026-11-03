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

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const WIDE = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif";

export type PromoOfferStyle =
  // caption, big badge, deadline under it
  | 'stacked'
  // big badge left, caption and deadline right of a hairline (stacks on phones)
  | 'split'
  // the deadline is the big line, the badge goes small (urgency)
  | 'countdown'
  // a framed bonus box after the body text
  | 'box';

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
    readonly caption: string;
    readonly font: string;
    readonly size: number;
    readonly phoneSize: number;
    readonly weight: number;
    readonly italic: boolean;
    readonly color: string;
    readonly meta: string;
    readonly boxBg?: string;
    readonly boxBorder?: string;
  };
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
    hero: { file: 'hero-1.png', width: 600, height: 400, bg: '#000000', altInk: '#d9d9d9',
      alt: 'Светящаяся сфера в звёздном небе, вокруг неё — зелёная стеклянная орбита' },
    page: '#1b1b1b', card: '#000000', border: '#2b2b2b', rule: '#2b2b2b', label: '#8f8f8f',
    body: { text: '#d4d4d4', heading: '#ffffff', link: '#9fe3b8', quote: '#bdbdbd', quoteBorder: '#3f8a5e', rule: '#2b2b2b', codeBg: '#1a1a1a',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 38 },
    h1Phone: 30,
    offer: { style: 'stacked', caption: 'прайм без оплаты', font: SERIF, size: 68, phoneSize: 50, weight: 400, italic: true, color: '#9fe3b8', meta: '#ffffff' },
    cta: { bg: '#9fe3b8', ink: '#000000', border: '#cff5dc', radius: 999, font: SANS, weight: 700, spacing: '0.2px', uppercase: false },
    footer: { ink: '#7a7a7a', link: '#b5b5b5' },
  },
  annual: {
    hero: { file: 'hero-1.png', width: 600, height: 380, bg: '#1e2196', altInk: '#eef0ff',
      alt: 'Ультрамариновое небо в полутоне: облака и лучи солнца' },
    page: '#d9dbf5', card: '#eef0ff', border: '#1e2196', rule: '#1e2196', label: '#1e2196',
    body: { text: '#1e2196', heading: '#1e2196', link: '#1e2196', quote: '#1e2196', quoteBorder: '#1e2196', rule: '#1e2196', codeBg: '#dfe1fb',
      font: SANS, headingFont: WIDE, headingWeight: 900, headingTransform: 'uppercase', headingSpacing: '0.5px', h1Size: 30 },
    h1Phone: 24,
    offer: { style: 'split', caption: 'на годовой тариф', font: WIDE, size: 84, phoneSize: 60, weight: 900, italic: false, color: '#1e2196', meta: '#1e2196' },
    cta: { bg: '#1e2196', ink: '#eef0ff', border: '#1e2196', radius: 0, font: WIDE, weight: 900, spacing: '2px', uppercase: true },
    footer: { ink: '#1e2196', link: '#1e2196' },
  },
  winback: {
    hero: { file: 'hero-1.png', width: 600, height: 380, bg: '#e6e5e1', altInk: '#262624',
      alt: 'Коллаж из рваной бумаги: луна, ночное небо и фазы луны за один месяц' },
    page: '#d6d5d1', card: '#e6e5e1', border: '#c4c2bd', rule: '#262624', label: '#4a4945',
    body: { text: '#262624', heading: '#000000', link: '#000000', quote: '#4a4945', quoteBorder: '#24432f', rule: '#a19f9a', codeBg: '#d8d7d3',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 40 },
    h1Phone: 31,
    offer: { style: 'stacked', caption: 'месяц от нас', font: SERIF, size: 64, phoneSize: 48, weight: 400, italic: true, color: '#000000', meta: '#24432f' },
    cta: { bg: '#000000', ink: '#e6e5e1', border: '#000000', radius: 999, font: SANS, weight: 700, spacing: '0.2px', uppercase: false },
    footer: { ink: '#5e5d59', link: '#262624' },
  },
  referral: {
    hero: { file: 'hero-1.png', width: 600, height: 380, bg: '#e3e4e0', altInk: '#123821',
      alt: 'Тёмно-зелёные шары на нитях и один стеклянный — команда на одной линии' },
    page: '#d4d5d1', card: '#e3e4e0', border: '#b5b6b2', rule: '#123821', label: '#3f403d',
    body: { text: '#1f2a22', heading: '#123821', link: '#1d5a33', quote: '#3f403d', quoteBorder: '#2f7a47', rule: '#b5b6b2', codeBg: '#d4d5d1',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 36 },
    h1Phone: 28,
    offer: { style: 'split', caption: 'за приглашение', font: SERIF, size: 60, phoneSize: 46, weight: 400, italic: false, color: '#123821', meta: '#1d5a33' },
    cta: { bg: '#123821', ink: '#e3e4e0', border: '#123821', radius: 0, font: SANS, weight: 700, spacing: '0.6px', uppercase: false },
    footer: { ink: '#5b5c58', link: '#123821' },
  },
  deadline: {
    hero: { file: 'hero-1.png', width: 600, height: 340, bg: '#ebeae6', altInk: '#1e2196',
      alt: 'Полутоновое синее солнце садится за горизонт и рассыпается на полосы' },
    page: '#dad9d5', card: '#ebeae6', border: '#a9a8a4', rule: '#000000', label: '#55544f',
    body: { text: '#222220', heading: '#000000', link: '#1e2196', quote: '#55544f', quoteBorder: '#1e2196', rule: '#a9a8a4', codeBg: '#dad9d5',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 34 },
    h1Phone: 27,
    offer: { style: 'countdown', caption: 'акция заканчивается', font: WIDE, size: 44, phoneSize: 32, weight: 900, italic: false, color: '#1e2196', meta: '#000000' },
    cta: { bg: '#1e2196', ink: '#ffffff', border: '#1e2196', radius: 0, font: WIDE, weight: 900, spacing: '1.5px', uppercase: true },
    footer: { ink: '#5e5d59', link: '#1e2196' },
  },
  news: {
    hero: { file: 'hero-1.png', width: 600, height: 390, bg: '#e8e7e3', altInk: '#262624',
      alt: 'Гравюра планеты с кольцом и человеком на вершине, подписи: канбан, входящие, воркер, Telegram' },
    page: '#d6d5d1', card: '#e8e7e3', border: '#b9b8b4', rule: '#000000', label: '#55544f',
    body: { text: '#262624', heading: '#000000', link: '#245c3c', quote: '#55544f', quoteBorder: '#3f8a5e', rule: '#b9b8b4', codeBg: '#d6d5d1',
      font: SANS, headingFont: SERIF, headingWeight: 400, h1Size: 36 },
    h1Phone: 28,
    offer: { style: 'box', caption: 'бонус к обновлению', font: SERIF, size: 34, phoneSize: 28, weight: 400, italic: true, color: '#123a24', meta: '#245c3c',
      boxBg: '#cff5dc', boxBorder: '#3f8a5e' },
    cta: { bg: '#000000', ink: '#e8e7e3', border: '#000000', radius: 999, font: SANS, weight: 700, spacing: '0.2px', uppercase: false },
    footer: { ink: '#5e5d59', link: '#262624' },
  },
};

/** Absolute URL of a layout's hero; the PNGs ship in client/public/mail/<layout>/. */
export function promoHeroUrl(assetBaseUrl: string, layout: PromoLayout): string {
  return `${assetBaseUrl.replace(/\/+$/, '')}/mail/${layout}/${PROMO_THEMES[layout].hero.file}`;
}
