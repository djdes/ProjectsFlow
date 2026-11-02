import type { MailingContent, MailingPreview } from '../../domain/mailing/Mailing.js';

export const escapeMailingHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function renderMailing(content: MailingContent, recipient: { name: string; company: string; email: string | null }, links: { unsubscribe?: string; buttonUrl?: string } = {}): MailingPreview {
  const values: Record<string, string> = { имя: recipient.name || 'коллега', компания: recipient.company || 'ваша команда', email: recipient.email || '', name: recipient.name || 'коллега', company: recipient.company || 'ваша команда' };
  const personalize = (value: string) => value.replace(/\{\{?(имя|компания|email|name|company)\}?\}/g, (_match, key: string) => values[key] ?? '');
  const subject = personalize(content.subject).replace(/[\r\n]+/g, ' ');
  const body = personalize(content.body);
  const url = links.buttonUrl ?? content.buttonUrl;
  const accent = content.kind === 'offer' ? '#0f766e' : '#2563eb';
  const button = url && content.buttonText ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${accent}" style="border-radius:8px;padding:14px 20px"><a href="${escapeMailingHtml(url)}" style="color:#fff;text-decoration:none;font-weight:600">${escapeMailingHtml(personalize(content.buttonText))}</a></td></tr></table>` : '';
  const paragraphs = body.split(/\n\s*\n/).map(text => `<p style="margin:0 0 18px;line-height:1.65">${escapeMailingHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join('');
  const footer = links.unsubscribe ? `<p style="font-size:12px;color:#6b7280;margin:28px 0 0">Сообщение от ProjectsFlow. <a href="${escapeMailingHtml(links.unsubscribe)}" style="color:#6b7280">Отписаться от рассылок</a></p>` : '<p style="font-size:12px;color:#6b7280;margin:28px 0 0">Предпросмотр · ProjectsFlow</p>';
  return {
    subject, buttonUrl: url,
    text: `${body}${url ? `\n\n${content.buttonText}: ${url}` : ''}${links.unsubscribe ? `\n\nОтписаться: ${links.unsubscribe}` : ''}`,
    html: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeMailingHtml(subject)}</title></head><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827"><div style="display:none;max-height:0;overflow:hidden">${escapeMailingHtml(personalize(content.preheader))}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px"><tr><td style="padding:28px 24px"><p style="margin:0 0 28px;font-weight:700;color:${accent}">ProjectsFlow</p>${content.kind !== 'message' ? `<h1 style="font-size:26px;line-height:1.25;margin:0 0 24px">${escapeMailingHtml(subject)}</h1>` : ''}${paragraphs}${button}${footer}</td></tr></table></td></tr></table></body></html>`,
  };
}
