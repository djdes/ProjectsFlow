// Порт хранилища контент-адресуемых блобов file-sync. Ключ = sha256 содержимого.
// Реализация (FileSystemBlobStorage) сама шардит по sha; storage_key детерминирован.
export interface BlobStorage {
  // Сохраняет байты под ключом sha256 (идемпотентно — повторный put тем же sha безопасен).
  put(sha256: string, data: Buffer): Promise<void>;
  read(sha256: string): Promise<Buffer | null>;
  has(sha256: string): Promise<boolean>;
  delete(sha256: string): Promise<void>;
  // Детерминированный относительный storage-ключ (пишется в sync_blobs.storage_key).
  storageKey(sha256: string): string;
}
