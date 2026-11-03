import type { EmailMessage } from '../notifications/EmailSender.js';
import type { MailingContent } from '../../domain/mailing/Mailing.js';
import {
  escapeMailingHtml as esc,
  fillMailingVariables,
  renderMailingBody,
  type MailingVariables,
} from '../../domain/mailing/renderMailingBody.js';

export type MailingEmailInput = {
  readonly to: string;
  readonly content: MailingContent;
  readonly vars: MailingVariables;
  readonly unsubscribeUrl: string;
  // Test letters go to the admin only and are marked in the subject.
  readonly test?: boolean;
};

// Invisible padding after the preheader keeps the inbox snippet from picking up body text.
const PREHEADER_PAD = '&#8199;&#847; '.repeat(60);

function safeCtaUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

/**
 * The marketing letter in the ProjectsFlow notification style (same palette, wordmark and
 * footer as renderEmailLayout) but fluid: a 600px card on desktop that fills the screen on
 * phones. Inline styles for every client; the media query only refines small screens.
 * The same HTML feeds the admin preview, the test send and the real send.
 */
export function renderMailingEmail(input: MailingEmailInput): EmailMessage {
  const { content, vars } = input;
  const subject = `${input.test ? '[Тест] ' : ''}${fillMailingVariables(content.subject, vars)}`.trim();
  const preheader = fillMailingVariables(content.preheader, vars).trim();
  const body = renderMailingBody(content.bodyMarkdown, vars);
  const ctaUrl = safeCtaUrl(content.ctaUrl);
  const ctaLabel = content.ctaLabel ? fillMailingVariables(content.ctaLabel, vars).trim() : '';
  const unsubscribe = esc(input.unsubscribeUrl);

  const cta = ctaUrl && ctaLabel
    ? `<tr><td class="pf-pad" style="padding:8px 32px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" class="pf-btn-table"><tr>
            <td style="border-radius:8px;background:#2563eb;">
              <a href="${esc(ctaUrl)}" class="pf-btn" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;line-height:1.2;padding:13px 28px;border-radius:8px;">${esc(ctaLabel)}</a>
            </td>
          </tr></table>
        </td></tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(subject)}</title>
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
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f1f5f9;">${esc(preheader)}${PREHEADER_PAD}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pf-shell" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pf-card" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td class="pf-pad" style="padding:28px 32px 12px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
        </td></tr>
        <tr><td class="pf-pad" style="padding:8px 32px 4px;word-break:break-word;">
          ${body.html}
        </td></tr>
        ${cta}
        <tr><td class="pf-pad" style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">Вы получили это письмо как пользователь ProjectsFlow. <a href="${unsubscribe}" style="color:#64748b;text-decoration:underline;">Отписаться от рассылок</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    body.text,
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
  return fillMailingVariables(content.preheader, vars).trim();
}
