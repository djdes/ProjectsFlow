// Файл собранного сайта: относительный путь (напр. "index.html", "assets/app.js") + байты.
export type SiteFile = {
  readonly path: string;
  readonly data: Buffer;
};

export interface SiteArtifactStorage {
  // Атомарно ЗАМЕНИТЬ содержимое сайта slug новым набором файлов (пишем во временную папку →
  // rename поверх старой). Возвращает счётчики. Path-traversal внутри реализации отсекается.
  replaceSite(slug: string, files: readonly SiteFile[]): Promise<{ fileCount: number; bytes: number }>;
  // Абсолютная папка сайта — для host-роутинга (express.static по <slug>.projectsflow.ru).
  siteDir(slug: string): string;
}
