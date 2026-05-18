export type TaskAttachment = {
  readonly id: string;
  readonly taskId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  // Относительный путь внутри хранилища (нам безразлично что именно — fs или S3 в будущем).
  readonly storageKey: string;
  readonly uploadedAt: Date;
};
