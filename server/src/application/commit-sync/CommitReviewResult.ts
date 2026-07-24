// Per-job payload сводки сверки коммитов (db/143). Считается при завершении job'а
// (CompleteCommitSyncJob → PrepareCommitReviewResult), сериализуется в commit_sync_jobs.review_json
// и позже агрегируется сборщиком батча в одно Telegram-сообщение. Хранит уже готовые строки задач
// (заголовок + ссылки), чтобы сборщику не пришлось повторно ходить в БД/создавать токены.

export type CommitReviewRow = {
  readonly title: string;
  readonly openUrl: string;
  // Ссылка на email-action «закрыть» (только режим propose и незакрытая задача). null иначе.
  readonly completeUrl: string | null;
};

export type CommitReviewResult = {
  // Telegram-группа пространства, куда уходит сводка (снимок на момент завершения).
  readonly chatId: number;
  readonly projectName: string;
  // 'auto' — задачи уже закрыты; 'propose' — предложено закрыть (у каждого проекта свой режим).
  readonly mode: 'auto' | 'propose';
  readonly rows: readonly CommitReviewRow[];
};

export function serializeCommitReviewResult(result: CommitReviewResult): string {
  return JSON.stringify(result);
}

// Защитный парс: битый/пустой JSON, неверный chatId или отсутствие строк → null (проект молчит).
export function parseCommitReviewResult(json: string | null): CommitReviewResult | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const chatId = obj['chatId'];
  const projectName = obj['projectName'];
  const mode = obj['mode'];
  const rows = obj['rows'];
  if (typeof chatId !== 'number' || !Number.isFinite(chatId)) return null;
  if (typeof projectName !== 'string') return null;
  if (mode !== 'auto' && mode !== 'propose') return null;
  if (!Array.isArray(rows)) return null;
  const parsedRows: CommitReviewRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r['title'] !== 'string' || typeof r['openUrl'] !== 'string') continue;
    parsedRows.push({
      title: r['title'],
      openUrl: r['openUrl'],
      completeUrl: typeof r['completeUrl'] === 'string' ? r['completeUrl'] : null,
    });
  }
  if (parsedRows.length === 0) return null;
  return { chatId, projectName, mode, rows: parsedRows };
}
