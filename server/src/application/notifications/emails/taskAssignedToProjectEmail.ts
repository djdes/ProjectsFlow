import type { EmailMessage } from '../EmailSender.js';

export type TaskAssignedToProjectEmailInput = {
  readonly to: string;
  readonly actorDisplayName: string;
  readonly taskExcerpt: string;
  readonly projectName: string;
  readonly projectUrl: string;
};

// Письмо делегату: создатель перенёс делегированную задачу в реальный проект.
// Если делегат — member проекта, увидит задачу в нём; иначе теряет доступ.
// Email — best-effort инфо о смене места задачи.
export function renderTaskAssignedToProjectEmail(
  input: TaskAssignedToProjectEmailInput,
): EmailMessage {
  const subject = `Задача перенесена в проект «${input.projectName}»`;

  const text = [
    `${input.actorDisplayName} перенёс делегированную вам задачу в проект «${input.projectName}»:`,
    '',
    `«${input.taskExcerpt}»`,
    '',
    `Открыть проект: ${input.projectUrl}`,
    '',
    'Если вы участник проекта — задача доступна в нём. Иначе доступ к ней закрыт.',
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
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Задача перенесена в проект</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
            <strong style="color:#0f172a;">${input.actorDisplayName}</strong> перенёс делегированную вам задачу в проект
            <strong style="color:#0f172a;">«${input.projectName}»</strong>:
          </p>
          <blockquote style="margin:12px 0 0;padding:12px 14px;border-left:3px solid #2563eb;background:#f8fafc;font-size:14px;line-height:1.5;color:#0f172a;">
            ${input.taskExcerpt}
          </blockquote>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.projectUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;">
            Открыть проект
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Если вы не участник проекта — доступ к задаче закрыт.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject, html, text };
}
