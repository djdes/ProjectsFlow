import type { EmailMessage } from '../EmailSender.js';

export type DelegationEmailInput = {
  readonly to: string;
  readonly actorDisplayName: string;
  readonly taskExcerpt: string;
  readonly inboxUrl: string;
};

// Письмо «вам делегировали задачу». Две кнопки (Принять / Отклонить) ведут на
// /inbox#delegation=<id>. Не magic-token accept (любой обладатель письма не
// должен иметь права принять за пользователя). Юзер логинится — попадает на inbox,
// видит блок «Делегировано мне».
export function renderDelegationEmail(input: DelegationEmailInput): EmailMessage {
  const subject = `${input.actorDisplayName} делегировал вам задачу в ProjectsFlow`;

  const text = [
    `${input.actorDisplayName} делегировал вам задачу:`,
    '',
    `«${input.taskExcerpt}»`,
    '',
    `Открыть «Входящие»: ${input.inboxUrl}`,
    '',
    'Там можно принять или отклонить.',
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
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Вам делегировали задачу</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
            <strong style="color:#0f172a;">${input.actorDisplayName}</strong> просит вас выполнить задачу:
          </p>
          <blockquote style="margin:12px 0 0;padding:12px 14px;border-left:3px solid #2563eb;background:#f8fafc;font-size:14px;line-height:1.5;color:#0f172a;">
            ${input.taskExcerpt}
          </blockquote>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.inboxUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;margin-right:8px;">
            Принять
          </a>
          <a href="${input.inboxUrl}" style="display:inline-block;background:#e2e8f0;color:#475569;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;">
            Отклонить
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Откройте «Входящие»:<br/>
            <a href="${input.inboxUrl}" style="color:#2563eb;word-break:break-all;">${input.inboxUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Если это ошибка — просто проигнорируйте это письмо.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject, html, text };
}
