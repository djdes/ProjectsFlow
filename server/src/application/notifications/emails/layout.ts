import type { EmailMessage } from '../EmailSender.js';

// Экранирование user-контента в HTML-письме (имя проекта, excerpt задачи/комментария,
// имя актора). Защита от HTML/JS-инъекции в теле письма.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type EmailLayoutInput = {
  readonly to: string;
  readonly subject: string;
  // Заголовок внутри карточки (h1).
  readonly heading: string;
  // Готовый HTML тела (уже экранированный вызывающим). Inline-CSS.
  readonly bodyHtml: string;
  // Plain-text версия (для text/plain части).
  readonly text: string;
  readonly ctaUrl: string;
  readonly ctaLabel: string;
};

// Общий каркас письма ProjectsFlow с CTA-кнопкой. Inline-CSS — почтовые клиенты
// игнорируют <style>/внешние стили. Чистая функция без I/O.
export function renderEmailLayout(input: EmailLayoutInput): EmailMessage {
  const html = `<!DOCTYPE html>
<html lang="ru">
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">${escapeHtml(input.heading)}</h1>
          <div style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">${input.bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.ctaUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:8px;">
            ${escapeHtml(input.ctaLabel)}
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Кнопка не работает? Откройте ссылку вручную:<br/>
            <a href="${input.ctaUrl}" style="color:#2563eb;word-break:break-all;">${input.ctaUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Это уведомление можно отключить в проекте → «Команда» → «Мои уведомления».</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject: input.subject, html, text: input.text };
}
