import type { EmailMessage, EmailSender } from '../../application/notifications/EmailSender.js';

// Fallback когда SMTP не сконфигурирован (нет SMTP_HOST). Логирует письмо в консоль —
// invite-flow продолжает работать, разработчик видит, что и куда «ушло».
export class LoggingEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    console.log(
      `[email:noop] → ${msg.to} | ${msg.subject}\n${msg.text}`,
    );
  }
}
