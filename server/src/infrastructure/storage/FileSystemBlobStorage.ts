import { mkdir, writeFile, readFile, unlink, access } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { BlobStorage } from '../../application/file-sync/BlobStorage.js';

// Файловое контент-адресуемое хранилище блобов. Шардинг blobs/<aa>/<bb>/<sha> чтобы не плодить
// миллионы файлов в одной директории. Корень — конструктор-арг (как FileSystemAttachmentStorage).
export class FileSystemBlobStorage implements BlobStorage {
  constructor(private readonly rootDir: string) {}

  storageKey(sha256: string): string {
    const clean = sha256.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error(`Invalid blob sha256: ${sha256}`);
    return `blobs/${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean}`;
  }

  private resolve(sha256: string): string {
    const key = this.storageKey(sha256);
    const safe = normalize(key).replace(/^[/\\]+/, '');
    const abs = join(this.rootDir, safe);
    const normalizedRoot = normalize(this.rootDir);
    if (!abs.startsWith(normalizedRoot + sep) && abs !== normalizedRoot) {
      throw new Error(`Blob key escapes root: ${sha256}`);
    }
    return abs;
  }

  async put(sha256: string, data: Buffer): Promise<void> {
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== sha256.toLowerCase()) {
      throw new Error(`Blob content sha mismatch: expected ${sha256}, got ${actual}`);
    }
    const path = this.resolve(sha256);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async read(sha256: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(sha256));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async has(sha256: string): Promise<boolean> {
    try {
      await access(this.resolve(sha256));
      return true;
    } catch {
      return false;
    }
  }

  async delete(sha256: string): Promise<void> {
    try {
      await unlink(this.resolve(sha256));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
