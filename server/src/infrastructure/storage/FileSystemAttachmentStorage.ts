import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type {
  AttachmentStorage,
  ReadResult,
  StoreInput,
} from '../../application/task/AttachmentStorage.js';

export class FileSystemAttachmentStorage implements AttachmentStorage {
  constructor(private readonly rootDir: string) {}

  private resolve(storageKey: string): string {
    // Защита от path traversal: нормализуем и проверяем что итоговый путь начинается с rootDir.
    // storageKey формируется сервером (uuid + ext), но защититься всё равно надо.
    const safe = normalize(storageKey).replace(/^[/\\]+/, '');
    const abs = join(this.rootDir, safe);
    const normalizedRoot = normalize(this.rootDir);
    if (!abs.startsWith(normalizedRoot + sep) && abs !== normalizedRoot) {
      throw new Error(`Storage key escapes root: ${storageKey}`);
    }
    return abs;
  }

  async put(input: StoreInput): Promise<void> {
    const path = this.resolve(input.storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.data);
  }

  async read(storageKey: string): Promise<ReadResult | null> {
    const path = this.resolve(storageKey);
    try {
      const data = await readFile(path);
      // mime-type не храним в файле — он живёт в task_attachments. Возвращаем
      // application/octet-stream как fallback; реальный mime придёт из caller'а
      // (он у нас знает mime_type из БД).
      return { data, mimeType: 'application/octet-stream' };
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const path = this.resolve(storageKey);
    try {
      await unlink(path);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
