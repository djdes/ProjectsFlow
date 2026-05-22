import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from '../../application/notifications/EmailSender.js';

export type SmtpConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly from: string;
  // true для 465 (implicit TLS); для 587/25 — false (STARTTLS).
  readonly secure: boolean;
};

// SMTP-реализация через nodemailer. Отправка best-effort на стороне вызывающего:
// ошибки прокидываем, но invite-flow их глотает (письмо — не критичный путь).
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      // Для 587 (secure=false) форсим STARTTLS — иначе письмо могло бы уйти в открытую.
      requireTLS: !config.secure,
      auth: { user: config.user, pass: config.password },
    });
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}
