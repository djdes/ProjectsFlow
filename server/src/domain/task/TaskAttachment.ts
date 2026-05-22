export type TaskAttachment = {
  readonly id: string;
  readonly taskId: string;
  // NULL — вложение самой задачи; иначе — вложение комментария.
  readonly commentId: string | null;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  // Относительный путь внутри хранилища (нам безразлично что именно — fs или S3 в будущем).
  readonly storageKey: string;
  readonly uploadedAt: Date;
};
