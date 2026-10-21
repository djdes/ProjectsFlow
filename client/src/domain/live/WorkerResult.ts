export type WorkerResultStatus = 'done' | 'pending_approval' | 'blocked' | 'error' | 'awaiting_clarification' | 'canceled' | 'timeout';
export type WorkerResult = {
  readonly status: WorkerResultStatus;
  readonly summary: string;
};

/** Recognize the final worker protocol, rather than treating arbitrary JSON as a result. */
export function parseWorkerResult(text: string): WorkerResult | null {
  const trimmed = text.trim();
  const fenced = /(?:^|\n)```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const preceding = fenced ? trimmed.slice(0, fenced.index).trim() : '';
  try {
    const value: unknown = JSON.parse(fenced?.[1] ?? trimmed);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.status !== 'string' || typeof row.summary !== 'string' || !row.summary.trim()) return null;
    if (!['done', 'pending_approval', 'blocked', 'error', 'awaiting_clarification', 'canceled', 'timeout'].includes(row.status)) return null;
    // Both fields belong to Ralph's final response. Never expose them in the message UI.
    if (typeof row.sha !== 'string' || typeof row.question_id !== 'string') return null;
    return { status: row.status as WorkerResultStatus, summary: [preceding, row.summary.trim()].filter(Boolean).join('\n\n') };
  } catch {
    // The worker protocol is explicitly the last line; retain any preceding explanation.
    const start = trimmed.lastIndexOf('\n{');
    if (start < 0) return null;
    const result = parseWorkerResult(trimmed.slice(start + 1));
    return result ? { ...result, summary: [trimmed.slice(0, start).trim(), result.summary].filter(Boolean).join('\n\n') } : null;
  }
}
