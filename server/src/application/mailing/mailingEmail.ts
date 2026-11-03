import type { EmailMessage } from '../notifications/EmailSender.js';
import type { MailingContent } from '../../domain/mailing/Mailing.js';
import { isMailingLayout } from '../../domain/mailing/layouts.js';
import {
  escapeMailingHtml as esc,
  fillMailingVariables,
  renderMailingBody,
  type MailingVariables,
} from '../../domain/mailing/renderMailingBody.js';
import { PROMO_THEMES, promoHeroUrl, type PromoLayout, type PromoTheme } from './promoLayouts.js';

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

  const html = layout === 'standard'
    ? standardHtml(parts)
    : promoHtml(parts, layout, offer && { badge: offer.badge, deadline: offer.deadline, caption: offer.caption || theme!.offer.caption }, input.assetBaseUrl ?? DEFAULT_ASSET_BASE);

  const offerText = theme && offer
    ? [offer.badge ? `${offer.caption || theme.offer.caption}: ${offer.badge}` : null, offer.deadline || null].filter(Boolean).join('\n')
    : null;
  const text = [
    theme?.offer.style === 'box' ? null : offerText,
    body.text,
    theme?.offer.style === 'box' ? offerText : null,
    ctaUrl && ctaLabel ? `${ctaLabel}: ${ctaUrl}` : null,
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

type Offer = { readonly badge: string; readonly deadline: string; readonly caption: string };

// Spaced lowercase caption, the family's label voice (refs 8 and 9).
function caption(t: PromoTheme, text: string, extra = ''): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;letter-spacing:3px;color:${t.label};${extra}">${esc(text)}</div>`;
}

function offerBig(t: PromoTheme, text: string): string {
  const o = t.offer;
  return `<div class="pf-offer" style="font-family:${o.font};font-size:${o.size}px;line-height:1;font-weight:${o.weight};${o.italic ? 'font-style:italic;' : ''}letter-spacing:${o.weight >= 900 ? '-1px' : '-0.5px'};color:${o.color};padding:8px 0 6px;word-break:break-word;">${esc(text)}</div>`;
}

function offerMeta(t: PromoTheme, text: string): string {
  return `<div style="font-family:Georgia,'Times New Roman',Times,serif;font-style:italic;font-size:17px;line-height:1.35;color:${t.offer.meta};">${esc(text)}</div>`;
}

function offerRow(t: PromoTheme, offer: Offer): string {
  const o = t.offer;
  if (o.style === 'box') {
    return `<tr><td class="pf-pad" style="padding:8px 32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${o.boxBg}" style="background:${o.boxBg};border:1px solid ${o.boxBorder};border-radius:18px;">
            <tr><td style="padding:18px 22px;">
              ${caption(t, offer.caption)}
              ${offer.badge ? offerBig(t, offer.badge) : ''}
              ${offer.deadline ? offerMeta(t, offer.deadline) : ''}
            </td></tr>
          </table>
        </td></tr>`;
  }
  if (o.style === 'split' && offer.badge) {
    return `<tr><td class="pf-pad" style="padding:28px 32px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td class="pf-stack" valign="bottom" style="padding:0 18px 0 0;">${offerBig(t, offer.badge)}</td>
            <td class="pf-stack pf-split-r" valign="bottom" width="190" style="width:190px;border-left:1px solid ${t.rule};padding:0 0 10px 18px;">
              ${caption(t, offer.caption, 'padding:0 0 6px;')}
              ${offer.deadline ? offerMeta(t, offer.deadline) : ''}
            </td>
          </tr></table>
        </td></tr>`;
  }
  // countdown swaps the emphasis: the deadline is the big line.
  const [big, small] = o.style === 'countdown' ? [offer.deadline || offer.badge, offer.deadline ? offer.badge : ''] : [offer.badge, offer.deadline];
  return `<tr><td class="pf-pad" style="padding:28px 32px 6px;">
          ${caption(t, offer.caption)}
          ${big ? offerBig(t, big) : ''}
          ${small ? offerMeta(t, small) : ''}
        </td></tr>`;
}

function promoHtml(p: Parts, layout: PromoLayout, offer: Offer | null, assetBaseUrl: string): string {
  const t = PROMO_THEMES[layout];
  const c = t.cta;
  const heroUrl = promoHeroUrl(assetBaseUrl, layout);
  const showOffer = offer && (offer.badge || offer.deadline);
  const offerTop = showOffer && t.offer.style !== 'box' ? offerRow(t, offer) : '';
  const offerAfter = showOffer && t.offer.style === 'box' ? offerRow(t, offer) : '';
  const cta = p.ctaUrl && p.ctaLabel
    ? `<tr><td class="pf-pad" style="padding:10px 32px 34px;">
          <table role="presentation" cellpadding="0" cellspacing="0" class="pf-btn-table"><tr>
            <td align="center" bgcolor="${c.bg}" style="border-radius:${c.radius}px;background:${c.bg};border:1px solid ${c.border};">
              <a href="${esc(p.ctaUrl)}" class="pf-btn" style="display:inline-block;background:${c.bg};color:${c.ink};text-decoration:none;font-family:${c.font};font-size:15px;font-weight:${c.weight};letter-spacing:${c.spacing};${c.uppercase ? 'text-transform:uppercase;' : ''}line-height:1.2;padding:16px 34px;border-radius:${c.radius}px;">${esc(p.ctaLabel)}</a>
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
  <meta name="format-detection" content="telephone=no, date=no, address=no">
  <title>${esc(p.subject)}</title>
  <style>
    @media (max-width: 480px) {
      .pf-shell { padding: 0 !important; }
      .pf-card { border-left: 0 !important; border-right: 0 !important; }
      .pf-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .pf-offer { font-size: ${t.offer.phoneSize}px !important; }
      .pf-h1 { font-size: ${t.h1Phone}px !important; }
      .pf-stack { display: block !important; width: 100% !important; }
      .pf-split-r { border-left: 0 !important; border-top: 1px solid ${t.rule} !important; padding: 10px 0 4px !important; }
      .pf-btn-table { width: 100% !important; }
      .pf-btn { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${t.page};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${t.page};">${esc(p.preheader)}${PREHEADER_PAD}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${t.page}" class="pf-shell" style="background:${t.page};padding:32px 12px;" data-pf-layout="${layout}">
    <tr><td align="center">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${t.card}" class="pf-card" style="width:100%;max-width:600px;background:${t.card};border:1px solid ${t.border};">
        <tr><td class="pf-pad" style="padding:16px 32px;border-bottom:1px solid ${t.rule};">
          ${caption(t, 'projectsflow')}
        </td></tr>
        <tr><td bgcolor="${t.hero.bg}" style="padding:0;background:${t.hero.bg};font-size:0;line-height:0;">
          <img src="${esc(heroUrl)}" width="${t.hero.width}" alt="${esc(t.hero.alt)}" style="display:block;width:100%;max-width:${t.hero.width}px;height:auto;border:0;outline:none;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:${t.hero.altInk};">
        </td></tr>
        ${offerTop}
        <tr><td class="pf-pad" style="padding:${offerTop ? '18px' : '30px'} 32px 4px;word-break:break-word;">
          ${p.bodyHtml}
        </td></tr>
        ${offerAfter}
        ${cta}
        <tr><td class="pf-pad" style="padding:18px 32px 22px;border-top:1px solid ${t.rule};">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:${t.footer.ink};">Вы получили это письмо как пользователь ProjectsFlow. <a href="${p.unsubscribe}" style="color:${t.footer.link};text-decoration:underline;">Отписаться от рассылок</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}
