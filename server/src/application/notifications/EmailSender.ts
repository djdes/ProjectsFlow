// Порт отправки писем. Application не знает про SMTP/nodemailer — только про контракт.
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly messageId?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}
