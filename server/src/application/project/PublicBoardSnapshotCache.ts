import type { PublicBoard, PublicTaskDetail } from '../../domain/project/PublicBoard.js';

export interface PublicBoardsIndexEntry {
  readonly projectId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly indexing: boolean;
  /** Локальный ключ в AttachmentStorage (`covers/<projectId>/<file>`), если обложка загружена файлом. */
  readonly coverStorageKey: string | null;
  readonly coverMimeType: string | null;
  readonly updatedAt: string;
}

export interface PublicBoardsIndexSnapshot {
  readonly slugs: Record<string, PublicBoardsIndexEntry>;
  readonly projectSlugs: Record<string, string>;
}

export interface PublicBoardBundleSnapshot {
  readonly board: PublicBoard | null;
  readonly tasks: Record<string, PublicTaskDetail>;
}

export interface PromoCacheStatusSummary {
  readonly cacheDir: string;
  readonly indexExists: boolean;
  readonly indexGeneratedAt: string | null;
  readonly publishedBoardsCount: number;
  readonly indexedBoardsCount: number;
}

export interface PublicBoardSnapshotCache {
  getBoard(slug: string): Promise<PublicBoard | null>;
  getTaskDetail(slug: string, taskId: string): Promise<PublicTaskDetail | null>;
  getCoverMeta(slug: string): Promise<{ storageKey: string; mimeType: string } | null>;
  listIndexedBoards(): Promise<readonly PublicBoardsIndexEntry[]>;
  refreshProject(projectId: string): Promise<void>;
  scheduleRefreshProject(projectId: string): void;
  refreshAll(): Promise<PromoCacheStatusSummary>;
  status(): PromoCacheStatusSummary;
}

const STATUS_LABEL_RU: Record<string, string> = {
  backlog: 'Черновики',
  todo: 'К выполнению',
  in_progress: 'В работе',
  awaiting_clarification: 'Ждёт уточнения',
  review: 'На утверждении',
  done: 'Готово',
};

export function renderPublicBoardMarkdown(board: PublicBoard, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const title = board.icon ? `${board.icon} ${board.name}` : board.name;
  const lines: string[] = [
    `# ${title}`,
    '',
    ...(board.description ? [`> ${board.description.replace(/\s+/g, ' ').trim()}`, ''] : []),
    `- Канонический адрес: ${base}/p/${board.slug}`,
    `- JSON API: ${base}/api/public/boards/${board.slug}`,
    '',
  ];

  for (const col of board.columns) {
    if (col.tasks.length === 0) continue;
    const label = STATUS_LABEL_RU[col.status] ?? col.status;
    lines.push(`## ${label} (${col.tasks.length})`, '');
    for (const t of col.tasks) {
      const raw = (t.description ?? '').trim();
      const firstLine = (raw.split(/\r?\n/)[0] ?? 'Задача').trim();
      const prefix = t.icon ? `${t.icon} ` : '';
      const meta: string[] = [];
      if (t.priority !== null) meta.push(`приоритет P${t.priority}`);
      if (t.deadline) meta.push(`срок ${t.deadline}`);
      const suffix = meta.length > 0 ? ` (${meta.join(', ')})` : '';
      lines.push(`- **${prefix}${firstLine}**${suffix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
