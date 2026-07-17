import { inflateRawSync } from 'node:zlib';
import { ProjectArchiveInvalidError } from '../../domain/project/errors.js';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export type ProjectZipFile = { readonly path: string; readonly content: Buffer };

function fail(message: string): never {
  throw new ProjectArchiveInvalidError(message);
}

function safePath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.endsWith('/')) return null;
  if (normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    fail('В архиве найден абсолютный путь');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail('В архиве найден небезопасный путь');
  }
  if (parts[0] === '__MACOSX' || parts.includes('.git') || parts.at(-1) === '.DS_Store') return null;
  return parts.join('/');
}

export function extractProjectZip(archive: Buffer): ProjectZipFile[] {
  if (archive.length < 22) fail('ZIP пустой или повреждён');
  let eocd = -1;
  const min = Math.max(0, archive.length - 65_557);
  for (let i = archive.length - 22; i >= min; i -= 1) {
    if (archive.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail('Не найдено окончание ZIP');
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const entries = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entries === 0xffff) fail('ZIP64 и многотомные ZIP не поддерживаются');
  if (entries > MAX_FILES) fail(`В ZIP больше ${MAX_FILES} файлов`);
  if (centralOffset + centralSize > archive.length) fail('Повреждён каталог ZIP');

  const files: ProjectZipFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL) {
      fail('Повреждена запись ZIP');
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttrs = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > archive.length) fail('Повреждено имя файла ZIP');
    const rawName = archive.subarray(cursor + 46, nameEnd).toString('utf8');
    cursor = nameEnd + extraLength + commentLength;

    const path = safePath(rawName);
    if (!path) continue;
    if ((flags & 1) !== 0) fail('Зашифрованные ZIP не поддерживаются');
    const unixType = (externalAttrs >>> 16) & 0xf000;
    if (unixType === 0xa000) fail('Символические ссылки в ZIP не поддерживаются');
    if (method !== 0 && method !== 8) fail(`Метод сжатия файла «${path}» не поддерживается`);
    if (size > MAX_FILE_BYTES) fail(`Файл «${path}» больше 25 МБ`);
    total += size;
    if (total > MAX_TOTAL_BYTES) fail('После распаковки проект больше 100 МБ');
    if (seen.has(path.toLowerCase())) fail(`Повторяющийся путь в ZIP: ${path}`);
    seen.add(path.toLowerCase());

    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL) {
      fail(`Повреждён файл «${path}»`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) fail(`Обрезан файл «${path}»`);
    const packed = archive.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      content = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: MAX_FILE_BYTES });
    } catch {
      fail(`Не удалось распаковать файл «${path}»`);
    }
    if (content.length !== size) fail(`Размер файла «${path}» не совпадает с ZIP`);
    files.push({ path, content });
  }

  if (files.length === 0) fail('В ZIP нет файлов проекта');

  // ZIP из Finder/GitHub часто содержит одну внешнюю папку. Убираем её, чтобы
  // package.json/index.html оказались в корне репозитория, а не на уровень глубже.
  const roots = new Set(files.map((file) => file.path.split('/')[0]));
  const stripRoot = roots.size === 1 && files.every((file) => file.path.includes('/'));
  return stripRoot
    ? files.map((file) => ({ ...file, path: file.path.slice(file.path.indexOf('/') + 1) }))
    : files;
}
