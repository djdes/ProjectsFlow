import type { EmailMessage } from '../EmailSender.js';

const roleLabel: Record<'editor' | 'viewer', string> = {
  editor: 'редактор',
  viewer: 'наблюдатель',
};

export type WorkspaceInviteEmailInput = {
  readonly to: string;
  readonly workspaceName: string;
  readonly actorDisplayName: string;
  readonly role: 'editor' | 'viewer';
  // `${appUrl}/invite/${token}` — тот же маршрут, что у project-инвайтов (dual-token).
  readonly acceptUrl: string;
};

// HTML-письмо с CTA «Принять приглашение». Inline-CSS — почтовые клиенты
// игнорируют <style>. Чистая функция без I/O — потому в application.
export function renderWorkspaceInviteEmail(input: WorkspaceInviteEmailInput): EmailMessage {
  const subject = `Вас пригласили в пространство «${input.workspaceName}» в ProjectsFlow`;

  const text = [
    `${input.actorDisplayName} приглашает вас в пространство «${input.workspaceName}» как ${roleLabel[input.role]}.`,
    'Вы получите доступ ко всем проектам пространства, включая будущие.',
    '',
    `Принять приглашение: ${input.acceptUrl}`,
    '',
    'Если вы не ожидали это письмо — просто проигнорируйте его.',
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
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Приглашение в пространство</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#334155;">
            <strong style="color:#0f172a;">${input.actorDisplayName}</strong> приглашает вас присоединиться к пространству
            <strong style="color:#0f172a;">«${input.workspaceName}»</strong> как <strong>${roleLabel[input.role]}</strong>.
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#64748b;">
            Вы получите доступ ко всем проектам пространства, включая будущие.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <a href="${input.acceptUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:8px;">
            Принять приглашение
          </a>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Кнопка не работает? Откройте ссылку вручную:<br/>
            <a href="${input.acceptUrl}" style="color:#2563eb;word-break:break-all;">${input.acceptUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Если вы не ожидали это письмо — просто проигнорируйте его.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { to: input.to, subject, html, text };
}
