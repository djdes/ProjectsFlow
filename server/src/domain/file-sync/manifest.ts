import { createHash } from 'node:crypto';

// Один файл в манифесте. path — POSIX-относительный (валидируется отдельно).
// mode: бит0 = exec. Символьная ссылка — isSymlink + symlinkTarget (blob_sha = null).
export type ManifestEntry = {
  readonly path: string;
  readonly sha256: string | null;
  readonly size: number;
  readonly mode: number;
  readonly mtimeMs?: number | null;
  readonly isSymlink?: boolean;
  readonly symlinkTarget?: string | null;
};

export const MODE_EXEC = 1;

// Content-токен для канонической сериализации: для symlink — литеральная цель (чтобы смена
// цели меняла manifest_sha), иначе — sha256 содержимого.
function contentToken(e: ManifestEntry): string {
  if (e.isSymlink) return `symlink:${e.symlinkTarget ?? ''}`;
  return e.sha256 ?? '';
}

// Байтовое (UTF-8) сравнение путей — culture-invariant, детерминированно для всех реализаций
// (C#/PowerShell/TS должны сортировать по UTF-8-байтам, НЕ по дефолтной локали).
function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// Канонический manifest_sha. Закреплённая сериализация: ordinal (byte-wise) сортировка POSIX-путей;
// строка = `path \0 contentToken \0 mode \0 size \n`. mtime ИСКЛЮЧАЕТСЯ (advisory). mode+size включены.
export function canonicalManifestSha(entries: readonly ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) => byteCompare(a.path, b.path));
  const h = createHash('sha256');
  for (const e of sorted) {
    h.update(e.path, 'utf8');
    h.update('\0');
    h.update(contentToken(e), 'utf8');
    h.update('\0');
    h.update(String(e.mode >>> 0));
    h.update('\0');
    h.update(String(e.size >>> 0));
    h.update('\n');
  }
  return h.digest('hex');
}

// Канонический хеш ignore-set (сервер — единственный источник истины; обе стороны тянут и сверяют).
export function canonicalIgnoreSetHash(patterns: readonly string[]): string {
  const sorted = [...patterns].sort(byteCompare);
  const h = createHash('sha256');
  for (const p of sorted) {
    h.update(p, 'utf8');
    h.update('\n');
  }
  return h.digest('hex');
}

export function manifestToMap(entries: readonly ManifestEntry[]): Map<string, ManifestEntry> {
  const m = new Map<string, ManifestEntry>();
  for (const e of entries) m.set(e.path, e);
  return m;
}
