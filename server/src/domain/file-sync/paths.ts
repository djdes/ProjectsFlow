import { createHash } from 'node:crypto';
import { InvalidManifestPathError } from './errors.js';

// Кросс-платформенный валидатор путей манифеста. Запускается на server-ingest И должен
// зеркалиться на client/dispatcher-apply (defense in depth). Путь — ВСЕГДА POSIX (forward-slash),
// относительный. Валидируем посегментно НЕЗАВИСИМО от ОС хоста, чтобы «отравленный» путь
// (backslash / .. / drive / UNC / NUL / reserved-name) не прошёл на Linux-бэкенде и не сбежал
// из корня на Windows-клиенте при apply.

const MAX_PATH_LEN = 1024;

// Windows-зарезервированные имена устройств (без учёта регистра, с/без расширения).
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export function validateManifestPath(path: string): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new InvalidManifestPathError(String(path), 'empty');
  }
  if (path.length > MAX_PATH_LEN) {
    throw new InvalidManifestPathError(path, `too long (> ${MAX_PATH_LEN})`);
  }
  if (path.includes('\0')) throw new InvalidManifestPathError(path, 'contains NUL');
  if (path.includes('\\')) throw new InvalidManifestPathError(path, 'contains backslash');
  if (path.startsWith('/')) throw new InvalidManifestPathError(path, 'absolute (leading slash)');

  const segments = path.split('/');
  for (const seg of segments) {
    if (seg.length === 0) throw new InvalidManifestPathError(path, 'empty segment (// or trailing /)');
    if (seg === '.' || seg === '..') throw new InvalidManifestPathError(path, 'relative segment . or ..');
    if (seg.includes(':')) throw new InvalidManifestPathError(path, 'colon (drive letter / ADS)');
    // Windows нормализует trailing-пробел/точку — запрещаем, чтобы не было неоднозначности.
    if (seg.endsWith(' ') || seg.endsWith('.')) {
      throw new InvalidManifestPathError(path, 'segment ends with space or dot');
    }
    const base = (seg.split('.')[0] ?? '').toLowerCase();
    if (RESERVED.has(base)) throw new InvalidManifestPathError(path, `reserved device name: ${seg}`);
  }
}

export function computePathHash(path: string): string {
  return createHash('sha256').update(Buffer.from(path, 'utf8')).digest('hex');
}

// Детект case-only коллизий в наборе путей (для Windows-origin workspace недопустимо).
// Возвращает пару столкнувшихся путей или null.
export function findCaseCollision(paths: readonly string[]): readonly [string, string] | null {
  const seen = new Map<string, string>();
  for (const p of paths) {
    const key = p.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined && prev !== p) return [prev, p];
    seen.set(key, p);
  }
  return null;
}
