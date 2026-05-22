import type { EmailMessage } from '../EmailSender.js';

export type JoinRequestEmailInput = {
  readonly to: string;
  readonly projectName: string;
  readonly requesterDisplayName: string;
  readonly projectUrl: string;
};

// Письмо владельцу проекта: кто-то просит доступ по совпадению git-репо.
export function renderJoinRequestEmail(input: JoinRequestEmailInput): EmailMessage {
  const subject = `Запрос доступа к проекту «${input.projectName}» в ProjectsFlow`;

  const text = [
    `${input.requesterDisplayName} использует тот же git-репозиторий и просит доступ к проекту «${input.projectName}».`,
    '',
    `Открыть проект и решить: ${input.projectUrl}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Запрос доступа</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
            <strong style="color:#0f172a;">${input.requesterDisplayName}</strong> использует тот же
            git-репозиторий и просит доступ к проекту
            <strong style="color:#0f172a;">«${input.projectName}»</strong>.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.projectUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:8px;">
            Открыть проект
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject, html, text };
}
