import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// Сбор собранной статики проекта с диска для pf_publish_site.
//
// Лимиты зеркалят multer-конфиг сервера (server/src/presentation/site/agentRoutes.ts):
// fileSize = 25 MB на файл, files = 2000. Превышение там оборачивается в невнятный
// multer-эксепшн уже после заливки половины тела — дешевле упасть локально с понятным текстом.
// Суммарный лимит сервер не задаёт; держим свой, чтобы не гнать гигабайты в один POST.
export const MAX_SITE_FILES = 2000;
export const MAX_SITE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SITE_TOTAL_BYTES = 100 * 1024 * 1024;

// Кандидаты на каталог сборки, когда `dir` не передан. Порядок = популярность.
export const DEFAULT_BUILD_DIRS = ['dist', 'build', 'out'] as const;

// Мусор сборщиков/ОС: в артефакт сайта не нужен.
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export type CollectedSiteFile = {
  // POSIX-путь относительно корня сборки ("index.html", "assets/app.js").
  readonly path: string;
  readonly data: Buffer;
};

export type CollectedSite = {
  readonly root: string;
  readonly files: readonly CollectedSiteFile[];
  readonly totalBytes: number;
  // Что осознанно не поехало (симлинки, служебный мусор) — чтобы агент не гадал.
  readonly skipped: readonly string[];
};

// Ошибка «виноват вызывающий»: каталога нет, он пуст, вылезли за лимиты.
export class SitePublishInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SitePublishInputError';
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// Резолвит каталог сборки. Явный `dir` — абсолютный или относительно cwd MCP-процесса
// (это рабочая папка Claude Code, т.е. корень репозитория проекта). Без `dir` перебираем
// DEFAULT_BUILD_DIRS и берём первый существующий.
export async function resolveBuildDir(dir: string | undefined, cwd: string): Promise<string> {
  if (dir !== undefined && dir.trim() !== '') {
    const root = isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir);
    if (!(await isDirectory(root))) {
      throw new SitePublishInputError(
        `Build directory not found: ${root}. Build the project first (e.g. \`npm run build\`), ` +
          `then pass the directory that contains index.html.`,
      );
    }
    return root;
  }
  for (const candidate of DEFAULT_BUILD_DIRS) {
    const root = resolve(cwd, candidate);
    if (await isDirectory(root)) return root;
  }
  throw new SitePublishInputError(
    `No build directory found in ${cwd} (looked for ${DEFAULT_BUILD_DIRS.join(', ')}). ` +
      `Build the project first, then pass "dir" explicitly.`,
  );
}

// Рекурсивно собирает файлы каталога, сохраняя относительные пути (POSIX-разделители —
// сервер кладёт их в filename и потом джойнит с папкой сайта). Обход детерминированный
// (readdir отсортирован), чтобы порядок заливки не плавал между вызовами.
export async function collectSiteFiles(root: string): Promise<CollectedSite> {
  const files: CollectedSiteFile[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const rel = relative(root, absolute).split(sep).join('/');
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      // Не-файлы (симлинки, сокеты) пропускаем: симлинк может увести за пределы сборки.
      if (!entry.isFile() || IGNORED_BASENAMES.has(entry.name)) {
        skipped.push(rel);
        continue;
      }
      if (files.length >= MAX_SITE_FILES) {
        throw new SitePublishInputError(
          `Too many files in ${root}: the server accepts at most ${MAX_SITE_FILES} per publish. ` +
            `Trim the build output (e.g. drop source maps) and retry.`,
        );
      }
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_SITE_FILE_BYTES) {
        throw new SitePublishInputError(
          `File too large: ${rel} is ${formatBytes(stat.size)}, the server limit is ` +
            `${formatBytes(MAX_SITE_FILE_BYTES)} per file.`,
        );
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_SITE_TOTAL_BYTES) {
        throw new SitePublishInputError(
          `Build is too big: over ${formatBytes(MAX_SITE_TOTAL_BYTES)} total. ` +
            `Publish a trimmed build (no source maps / raw media).`,
        );
      }
      files.push({ path: rel, data: await fs.readFile(absolute) });
    }
  };

  await walk(root);

  if (files.length === 0) {
    throw new SitePublishInputError(
      `Build directory ${root} has no files to publish. Did the build actually run?`,
    );
  }
  return { root, files, totalBytes, skipped };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
