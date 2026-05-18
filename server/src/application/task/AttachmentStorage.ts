// Port для хранилища бинарей-аттачей. Сейчас имплементируется через FS,
// в будущем можно подменить на S3/R2 — ничего не меняя в use-case'ах.

export type StoreInput = {
  readonly storageKey: string;
  readonly data: Buffer;
  readonly mimeType: string;
};

export type ReadResult = {
  readonly data: Buffer;
  readonly mimeType: string;
};

export interface AttachmentStorage {
  put(input: StoreInput): Promise<void>;
  read(storageKey: string): Promise<ReadResult | null>;
  delete(storageKey: string): Promise<void>;
}
