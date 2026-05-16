export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
