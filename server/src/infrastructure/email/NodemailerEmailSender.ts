import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from '../../application/email/EmailSender.js';

export type SmtpConfig = {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
};

export class NodemailerEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly cfg: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.cfg.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
