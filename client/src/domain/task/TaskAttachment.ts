export type TaskAttachment = {
  readonly id: string;
  readonly taskId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly url: string;
  readonly uploadedAt: Date;
  // Локальное состояние догрузки вложения в уже показанном комментарии:
  // blob-превью видно сразу после нажатия «Отправить», поверх — прогресс 0..100.
  readonly uploading?: boolean;
  readonly uploadProgress?: number;
};
