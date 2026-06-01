import type { LiveFileChange } from './LiveEvent';

// Полный git-дифф одного файла за сессию (собирается из событий `file_diff`).
// `unifiedDiff` — текст в unified-формате (`+`/`-` строки), capped на сервере;
// `truncated` — флаг что дифф обрезан по размеру; бинарники приходят с `isBinary`
// и без `unifiedDiff`.
export type LiveFileDiff = {
  readonly path: string;
  readonly change: LiveFileChange;
  readonly additions: number;
  readonly deletions: number;
  readonly unifiedDiff: string | null;
  readonly isBinary: boolean;
  readonly truncated: boolean;
};
