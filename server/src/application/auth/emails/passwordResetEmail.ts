import type { EmailMessage } from '../../notifications/EmailSender.js';
import { renderEmailLayout } from '../../notifications/emails/layout.js';

export type PasswordResetEmailInput = {
  readonly to: string;
  readonly resetUrl: string;
  readonly ttlMinutes: number;
};

// Письмо со ссылкой сброса пароля. resetUrl уже собран вызывающим (с токеном). Чистая
// функция без I/O — потому в application.
export function renderPasswordResetEmail(input: PasswordResetEmailInput): EmailMessage {
  const ttl =
    input.ttlMinutes >= 60
      ? `${Math.round(input.ttlMinutes / 60)} ч`
      : `${input.ttlMinutes} мин`;

  const bodyHtml = `
    Вы (или кто-то) запросили сброс пароля для этого аккаунта в ProjectsFlow.
    Ссылка действительна ${ttl}. Если вы не запрашивали сброс — просто проигнорируйте это письмо,
    пароль останется прежним.`;

  const text = [
    'Сброс пароля ProjectsFlow.',
    '',
    `Чтобы задать новый пароль, откройте ссылку (действительна ${ttl}):`,
    input.resetUrl,
    '',
    'Если вы не запрашивали сброс — проигнорируйте это письмо.',
  ].join('\n');

  return renderEmailLayout({
    to: input.to,
    subject: 'Сброс пароля в ProjectsFlow',
    heading: 'Сброс пароля',
    bodyHtml,
    text,
    ctaUrl: input.resetUrl,
    ctaLabel: 'Задать новый пароль',
  });
}
