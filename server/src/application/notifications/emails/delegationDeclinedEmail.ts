import type { EmailMessage } from '../EmailSender.js';

export type DelegationDeclinedEmailInput = {
  readonly to: string;
  readonly delegateDisplayName: string;
  readonly taskExcerpt: string;
  readonly inboxUrl: string;
};

// Письмо создателю: «делегат отклонил вашу задачу». Шлём email (важная инфо —
// нужно перераспределить). Кнопка ведёт на inbox, задача там уже без ярлыка
// делегирования (статус delegation = declined).
export function renderDelegationDeclinedEmail(
  input: DelegationDeclinedEmailInput,
): EmailMessage {
  const subject = `${input.delegateDisplayName} отклонил делегированную задачу`;

  const text = [
    `${input.delegateDisplayName} отклонил вашу задачу:`,
    '',
    `«${input.taskExcerpt}»`,
    '',
    `Открыть «Входящие»: ${input.inboxUrl}`,
    '',
    'Задача снова доступна в ваших входящих — можно делегировать другому или выполнить самим.',
  ].join('\n');

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
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Делегирование отклонено</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
            <strong style="color:#0f172a;">${input.delegateDisplayName}</strong> отклонил вашу задачу:
          </p>
          <blockquote style="margin:12px 0 0;padding:12px 14px;border-left:3px solid #f59e0b;background:#fffbeb;font-size:14px;line-height:1.5;color:#0f172a;">
            ${input.taskExcerpt}
          </blockquote>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.inboxUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;">
            Открыть «Входящие»
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Задача снова доступна — можно делегировать другому или выполнить самим.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject, html, text };
}
