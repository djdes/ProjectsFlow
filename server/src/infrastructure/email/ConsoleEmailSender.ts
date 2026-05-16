import type { EmailMessage, EmailSender } from '../../application/email/EmailSender.js';

// Dev-only fallback: пишет письмо в stdout. Нужно когда SMTP не настроен,
// чтобы можно было выдернуть magic-link прямо из логов.
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const banner = '─'.repeat(60);
    console.log(`\n${banner}`);
    console.log(`[email:dev] to=${message.to}`);
    console.log(`[email:dev] subject=${message.subject}`);
    console.log(`[email:dev] body:\n${message.text}`);
    console.log(`${banner}\n`);
  }
}
