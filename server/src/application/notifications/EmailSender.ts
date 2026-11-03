// Порт отправки писем. Application не знает про SMTP/nodemailer — только про контракт.
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  // Extra MIME headers (List-Unsubscribe for marketing letters). Optional for every sender.
  readonly headers?: Readonly<Record<string, string>>;
};

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}
