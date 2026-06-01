// Одно live-событие ленты воркера. Хранится в task_progress_events (append-only, UNIQUE(task_id,seq)).
// Виды (kind): assistant_text, tool_use, file_edit, file_write, bash, tool_error,
// diff_summary, file_diff, session_finished.

export type LiveEvent = {
  readonly seq: number;
  readonly kind: string;
  readonly text: string | null;
  readonly payload: unknown;
  readonly createdAt: Date;
};

// Входной (append) формат события от воркера/агента — без createdAt (ставит БД).
export type LiveEventInput = {
  readonly seq: number;
  readonly kind: string;
  readonly text?: string | null;
  readonly payload?: unknown;
};
