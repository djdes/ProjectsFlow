// Полный git-дифф одного файла за сессию (финал). Хранится как событие kind='file_diff'
// (payload). unifiedDiff капается на стороне источника; бинарники помечаются isBinary.

export type LiveFileChange = 'added' | 'modified' | 'deleted' | 'renamed';

export type LiveFileDiff = {
  readonly path: string;
  readonly change: LiveFileChange;
  readonly additions: number;
  readonly deletions: number;
  readonly unifiedDiff: string | null;
  readonly isBinary: boolean;
  readonly truncated: boolean;
};
