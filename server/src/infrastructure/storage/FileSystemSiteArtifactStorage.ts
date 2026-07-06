import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SiteArtifactStorage, SiteFile } from '../../application/site/SiteArtifactStorage.js';

// slug сайта — только [a-z0-9-]; это и имя папки, защита от path-traversal через сам slug.
const SLUG_RE = /^[a-z0-9-]+$/;

// Файловое хранилище собранных сайтов: <rootDir>/<slug>/... Заливка атомарна (пишем во временную
// папку → rm старой → rename). rootDir в проде указывает вне deploy-tarball (переживает релизы).
export class FileSystemSiteArtifactStorage implements SiteArtifactStorage {
  constructor(private readonly rootDir: string) {}

  siteDir(slug: string): string {
    if (!SLUG_RE.test(slug)) throw new Error(`invalid site slug: ${slug}`);
    return path.join(this.rootDir, slug);
  }

  async replaceSite(
    slug: string,
    files: readonly SiteFile[],
  ): Promise<{ fileCount: number; bytes: number }> {
    if (!SLUG_RE.test(slug)) throw new Error(`invalid site slug: ${slug}`);
    const finalDir = path.join(this.rootDir, slug);
    const tmpDir = path.join(this.rootDir, `.tmp-${slug}`);

    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });

    const tmpRoot = path.resolve(tmpDir);
    let bytes = 0;
    for (const f of files) {
      const dest = path.resolve(path.join(tmpDir, f.path));
      // Каждый файл обязан лежать ВНУТРИ tmpDir — отсекаем `..`/абсолютные пути.
      if (dest !== tmpRoot && !dest.startsWith(tmpRoot + path.sep)) {
        throw new Error(`unsafe file path: ${f.path}`);
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.data);
      bytes += f.data.length;
    }

    await fs.rm(finalDir, { recursive: true, force: true });
    await fs.rename(tmpDir, finalDir);
    return { fileCount: files.length, bytes };
  }
}
