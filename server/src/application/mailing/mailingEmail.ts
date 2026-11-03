import type { EmailMessage } from '../notifications/EmailSender.js';
import type { MailingContent } from '../../domain/mailing/Mailing.js';
import { isMailingLayout, splitOfferPrice } from '../../domain/mailing/layouts.js';
import {
  escapeMailingHtml as esc,
  fillMailingVariables,
  renderMailingBody,
  type MailingVariables,
} from '../../domain/mailing/renderMailingBody.js';
import {
  PROMO_THEMES, isLastDayDeadline, promoBadgePhoneSizes, promoBadgeSize, promoHeroUrl, type PromoLayout, type PromoTheme,
} from './promoLayouts.js';

export type MailingEmailInput = {
  readonly to: string;
  readonly content: MailingContent;
  readonly vars: MailingVariables;
  readonly unsubscribeUrl: string;
  // Public app origin the hero images are served from (client/public/mail/*).
  readonly assetBaseUrl?: string;
  // Test letters go to the admin only and are marked in the subject.
  readonly test?: boolean;
};

const DEFAULT_ASSET_BASE = 'https://projectsflow.ru';

// Invisible padding after the preheader keeps the inbox snippet from picking up body text.
const PREHEADER_PAD = '&#8199;&#847; '.repeat(60);

function safeCtaUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

type Parts = {
  readonly subject: string;
  readonly preheader: string;
  readonly bodyHtml: string;
  readonly ctaUrl: string | null;
  readonly ctaLabel: string;
  readonly unsubscribe: string;
};

/**
 * The marketing letter: the classic notification-style card ('standard') or one of the
 * promo layouts. Fluid everywhere: a 600px card on desktop that fills the screen on phones.
 * Inline styles for every client; the media query only refines small screens. The same HTML
 * feeds the admin preview, the test send and the real send.
 */
export function renderMailingEmail(input: MailingEmailInput): EmailMessage {
  const { content } = input;
  const layout = isMailingLayout(content.layout) ? content.layout : 'standard';
  const offer = layout === 'standard' ? null : content.offer ?? null;
  // Promo terms are template-wide variables next to the recipient's own.
  const vars: MailingVariables = { ...input.vars, offer: offer?.badge ?? '', deadline: offer?.deadline ?? '' };
  const subject = `${input.test ? '[Тест] ' : ''}${fillMailingVariables(content.subject, vars)}`.trim();
  const preheader = fillMailingVariables(content.preheader, vars).trim();
  const theme = layout === 'standard' ? null : PROMO_THEMES[layout];
  const body = renderMailingBody(content.bodyMarkdown, vars, theme?.body);
  const ctaUrl = safeCtaUrl(content.ctaUrl);
  const ctaLabel = content.ctaLabel ? fillMailingVariables(content.ctaLabel, vars).trim() : '';
  const parts: Parts = { subject, preheader, bodyHtml: body.html, ctaUrl, ctaLabel, unsubscribe: esc(input.unsubscribeUrl) };

  const promoOffer: Offer | null = theme && offer
    ? { badge: offer.badge, deadline: offer.deadline, caption: offer.caption || theme.offer.caption, price: offer.price ?? '' }
    : null;
  const html = layout === 'standard'
    ? standardHtml(parts)
    : promoHtml(parts, layout, promoOffer, input.assetBaseUrl ?? DEFAULT_ASSET_BASE);

  // Plain text mirrors the HTML order: offer, button, body, button again.
  const offerText = promoOffer
    ? [promoOffer.deadline || null, promoOffer.badge ? `${promoOffer.caption}: ${promoOffer.badge}` : null, promoOffer.price || null].filter(Boolean).join('\n')
    : null;
  const ctaText = ctaUrl && ctaLabel ? `${ctaLabel}: ${ctaUrl}` : null;
  const text = [
    offerText,
    theme ? ctaText : null,
    body.text,
    ctaText,
    '—',
    `Отписаться от рассылок: ${input.unsubscribeUrl}`,
  ].filter(Boolean).join('\n\n');

  return {
    to: input.to,
    subject,
    html,
    text,
    // RFC 2369 + RFC 8058 one-click: mail providers show their own «Отписаться» button.
    headers: {
      'List-Unsubscribe': `<${input.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      Precedence: 'bulk',
    },
  };
}

/** Plain-text preheader shown in the preview's inbox row. */
export function renderMailingPreheader(content: MailingContent, vars: MailingVariables): string {
  const offer = content.layout === 'standard' ? null : content.offer ?? null;
  return fillMailingVariables(content.preheader, { ...vars, offer: offer?.badge ?? '', deadline: offer?.deadline ?? '' }).trim();
}

function standardHtml(p: Parts): string {
  const cta = p.ctaUrl && p.ctaLabel
    ? `<tr><td class="pf-pad" style="padding:8px 32px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" class="pf-btn-table"><tr>
            <td style="border-radius:8px;background:#2563eb;">
              <a href="${esc(p.ctaUrl)}" class="pf-btn" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;line-height:1.2;padding:13px 28px;border-radius:8px;">${esc(p.ctaLabel)}</a>
            </td>
          </tr></table>
        </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(p.subject)}</title>
  <style>
    @media (max-width: 480px) {
      .pf-shell { padding: 0 !important; }
      .pf-card { border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
      .pf-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .pf-btn-table { width: 100% !important; }
      .pf-btn { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f1f5f9;">${esc(p.preheader)}${PREHEADER_PAD}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pf-shell" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pf-card" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td class="pf-pad" style="padding:28px 32px 12px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
        </td></tr>
        <tr><td class="pf-pad" style="padding:8px 32px 4px;word-break:break-word;">
          ${p.bodyHtml}
        </td></tr>
        ${cta}
        <tr><td class="pf-pad" style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">Вы получили это письмо как пользователь ProjectsFlow. <a href="${p.unsubscribe}" style="color:#64748b;text-decoration:underline;">Отписаться от рассылок</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

type Offer = { readonly badge: string; readonly deadline: string; readonly caption: string; readonly price: string };

const LABEL_FONT = 'Arial,Helvetica,sans-serif';
const SERIF_FONT = "Georgia,'Times New Roman',Times,serif";
const WIDE_FONT = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif";

// Prices and amounts never break across lines: «15 960 ₽» keeps its spaces together. The
// offer fields are whitespace-normalized on save, so this happens at render time.
const NBSP = String.fromCharCode(0xa0);
function keepNumbers(text: string): string {
  return text.replace(/(\d)\s(?=\d{3}(?!\d))/g, `$1${NBSP}`).replace(/(\d)\s(?=₽)/g, `$1${NBSP}`);
}

// Spaced lowercase caption, the family's label voice (refs 8 and 9).
function caption(t: PromoTheme, text: string, extra = ''): string {
  return `<div style="font-family:${LABEL_FONT};font-size:11px;line-height:1.4;letter-spacing:3px;color:${t.label};${extra}">${esc(text)}</div>`;
}

// Bulletproof button: the cell carries the colour, so it survives blocked styles and images.
function button(href: string, label: string, s: PromoTheme['cta'], cls: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="pf-btn-table"><tr>
            <td align="center" bgcolor="${s.bg}" style="border-radius:${s.radius}px;background:${s.bg};border:1px solid ${s.border};">
              <a href="${esc(href)}" class="pf-btn ${cls}" style="display:inline-block;min-width:220px;background:${s.bg};color:${s.ink};text-decoration:none;font-family:${s.font};font-size:18px;font-weight:${s.weight};letter-spacing:${s.spacing};${s.uppercase ? 'text-transform:uppercase;' : ''}line-height:1.2;text-align:center;padding:18px 34px;border-radius:${s.radius}px;">${esc(label)}</a>
            </td>
          </tr></table>`;
}

function chip(t: PromoTheme, text: string): string {
  const c = t.offer.chip;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr>
            <td bgcolor="${c.bg}" class="pf-chip" style="background:${c.bg};border-radius:${c.radius}px;padding:7px 14px;font-family:${LABEL_FONT};font-size:14px;line-height:1.25;font-weight:700;color:${c.ink};">${esc(keepNumbers(text))}</td>
          </tr></table>`;
}

// Last-day deadline («сегодня до 23:59»): a full-width ribbon above the badge.
function ribbon(t: PromoTheme, text: string): string {
  const r = t.offer.ribbon!;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr>
            <td bgcolor="${r.bg}" class="pf-ribbon" style="background:${r.bg};padding:12px 16px;font-family:${WIDE_FONT};font-size:28px;line-height:1.1;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;color:${r.ink};">${esc(text)}</td>
          </tr></table>`;
}

function badge(t: PromoTheme, text: string): string {
  const o = t.offer;
  const size = promoBadgeSize(t, text);
  return `<div class="pf-offer pf-offer-${size.tier}" style="font-family:${o.font};font-size:${size.desktop}px;line-height:0.98;font-weight:${o.weight};${o.italic ? 'font-style:italic;' : ''}letter-spacing:${o.weight >= 900 ? '-2px' : '-1px'};color:${o.ink};padding:2px 0 8px;word-break:break-word;">${esc(text)}</div>`;
}

function offerCaption(t: PromoTheme, text: string): string {
  const o = t.offer;
  const serif = o.font === SERIF_FONT;
  return `<div style="font-family:${serif ? SERIF_FONT : LABEL_FONT};${serif ? 'font-style:italic;' : 'font-weight:700;'}font-size:${serif ? 22 : 18}px;line-height:1.25;color:${o.sub};">${esc(keepNumbers(text))}</div>`;
}

function priceLine(t: PromoTheme, text: string): string {
  const o = t.offer;
  const parts = splitOfferPrice(keepNumbers(text));
  const inner = parts
    ? `<b style="font-weight:700;color:${o.ink};">${esc(parts.now)}</b> вместо <s style="text-decoration:line-through;">${esc(parts.was)}</s>`
    : esc(keepNumbers(text));
  return `<div style="font-family:${LABEL_FONT};font-size:18px;line-height:1.4;color:${o.sub};padding:6px 0 0;">${inner}</div>`;
}

/**
 * The offer field right under the hero: deadline chip (or last-day ribbon), the badge as the
 * biggest line, caption and price, the primary button. Without an offer it still holds the
 * button, so the art's colour edge always lands on something.
 */
function offerField(t: PromoTheme, offer: Offer | null, cta: { href: string; label: string } | null): string {
  const o = t.offer;
  const lastDay = offer?.deadline ? isLastDayDeadline(t, offer.deadline) : false;
  const top = offer?.deadline ? (lastDay ? ribbon(t, offer.deadline) : chip(t, offer.deadline)) : '';
  const side = offer ? `${offer.caption ? offerCaption(t, offer.caption) : ''}${offer.price ? priceLine(t, offer.price) : ''}` : '';
  let main = '';
  // Split only while the badge fits beside the side column in one line; longer badges stack.
  const tier = offer?.badge ? promoBadgeSize(t, offer.badge).tier : 'xs';
  const splitFits = tier === 'l' || (tier === 'm' && o.font !== WIDE_FONT);
  if (offer?.badge && o.style === 'split' && side && splitFits) {
    main = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td class="pf-stack" valign="bottom" style="padding:0 18px 0 0;">${badge(t, offer.badge)}</td>
            <td class="pf-stack pf-split-r" valign="bottom" width="210" style="width:210px;border-left:2px solid ${o.rule};padding:0 0 14px 18px;">${side}</td>
          </tr></table>`;
  } else if (offer?.badge) {
    main = `${offer.caption ? offerCaption(t, offer.caption) : ''}${badge(t, offer.badge)}${offer.price ? priceLine(t, offer.price) : ''}`;
  }
  const btn = cta
    ? `<div style="padding:${main || top ? '22px' : '0'} 0 0;">${button(cta.href, cta.label, { ...t.cta, bg: o.button.bg, ink: o.button.ink, border: o.button.bg }, 'pf-btn-main')}</div>`
    : '';
  if (!main && !btn && !top) return `<tr><td bgcolor="${o.field}" style="background:${o.field};font-size:0;line-height:0;height:14px;">&nbsp;</td></tr>`;
  return `<tr><td bgcolor="${o.field}" class="pf-pad pf-field" style="background:${o.field};padding:22px 32px 32px;" data-pf-offer>
          ${top}
          ${main}
          ${btn}
        </td></tr>`;
}

function promoHtml(p: Parts, layout: PromoLayout, offer: Offer | null, assetBaseUrl: string): string {
  const t = PROMO_THEMES[layout];
  const heroUrl = promoHeroUrl(assetBaseUrl, layout);
  const cta = p.ctaUrl && p.ctaLabel ? { href: p.ctaUrl, label: p.ctaLabel } : null;
  const field = offerField(t, offer && (offer.badge || offer.deadline) ? offer : null, cta);
  const ctaEnd = cta
    ? `<tr><td class="pf-pad" style="padding:12px 32px 36px;">
          ${button(cta.href, cta.label, t.cta, 'pf-btn-end')}
        </td></tr>`
    : '';
  const phoneBadges = promoBadgePhoneSizes(t).map(([tier, px]) => `.pf-offer-${tier} { font-size: ${px}px !important; letter-spacing: -1px !important; }`).join('\n      ');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <meta name="format-detection" content="telephone=no, date=no, address=no">
  <title>${esc(p.subject)}</title>
  <style>
    @media (max-width: 480px) {
      .pf-shell { padding: 0 !important; }
      .pf-card { border-left: 0 !important; border-right: 0 !important; }
      .pf-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .pf-field { padding-top: 18px !important; padding-bottom: 26px !important; }
      ${phoneBadges}
      .pf-ribbon { font-size: 22px !important; }
      .pf-h1 { font-size: ${t.h1Phone}px !important; }
      .pf-stack { display: block !important; width: 100% !important; }
      .pf-split-r { border-left: 0 !important; border-top: 2px solid ${t.offer.rule} !important; padding: 10px 0 0 !important; }
      .pf-btn-table { width: 100% !important; }
      .pf-btn { display: block !important; min-width: 0 !important; text-align: center !important; padding-left: 12px !important; padding-right: 12px !important;${t.cta.uppercase ? ' font-size: 16px !important; letter-spacing: 0.5px !important;' : ''} }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${t.page};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${t.page};">${esc(p.preheader)}${PREHEADER_PAD}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${t.page}" class="pf-shell" style="background:${t.page};padding:32px 12px;" data-pf-layout="${layout}">
    <tr><td align="center">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${t.card}" class="pf-card" style="width:100%;max-width:600px;background:${t.card};border:1px solid ${t.border};">
        <tr><td class="pf-pad" style="padding:14px 32px;border-bottom:1px solid ${t.rule};">
          ${caption(t, 'projectsflow')}
        </td></tr>
        <tr><td bgcolor="${t.hero.bg}" style="padding:0;background:${t.hero.bg};font-size:0;line-height:0;">
          <img src="${esc(heroUrl)}" width="${t.hero.width}" alt="${esc(t.hero.alt)}" style="display:block;width:100%;max-width:${t.hero.width}px;height:auto;border:0;outline:none;text-decoration:none;font-family:${LABEL_FONT};font-size:13px;line-height:1.4;color:${t.hero.altInk};">
        </td></tr>
        ${field}
        <tr><td class="pf-pad" style="padding:30px 32px 4px;word-break:break-word;">
          ${p.bodyHtml}
        </td></tr>
        ${ctaEnd}
        <tr><td class="pf-pad" style="padding:18px 32px 22px;border-top:1px solid ${t.rule};">
          <p style="margin:0;font-family:${LABEL_FONT};font-size:12px;line-height:1.55;color:${t.footer.ink};">Вы получили это письмо как пользователь ProjectsFlow. <a href="${p.unsubscribe}" style="color:${t.footer.link};text-decoration:underline;">Отписаться от рассылок</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}
