// Вложение сообщения чата. Бинарь лежит в AttachmentStorage (FS/S3) по storageKey;
// width/height заполнены только для картинок (для превью без скачивания).
export type ChatAttachment = {
  readonly id: string;
  readonly messageId: string;
  readonly storageKey: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number | null;
  readonly height: number | null;
};
