export type TaskAttachment = {
  readonly id: string;
  readonly taskId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly url: string;
  readonly uploadedAt: Date;
};
