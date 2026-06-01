// Доменное событие LIVE-ленты воркера. Append-only, нумеруется монотонным `seq`
// в пределах задачи. `payload` — структурированные данные конкретного `kind`
// (см. контракт сервера). Сырой `text` — для assistant_text / tool_error и т.п.
//
// Известные виды (kind) — строка, чтобы старый UI не падал на новых видах:
//   assistant_text  — текст/рассуждение ассистента (markdown)
//   tool_use        — вызов инструмента        payload {name, brief}
//   file_edit       — Edit/MultiEdit (hunks)   payload {path, edits:[{old,new}]}
//   file_write      — Write (полный файл)       payload {path, content}
//   bash            — Bash-команда              payload {command}
//   tool_error      — ошибка инструмента        text
//   diff_summary    — сводка git-диффа в конце   payload {files:[{path,change,additions,deletions}]}
//   file_diff       — полный unified diff файла  payload {path,change,additions,deletions,unifiedDiff,isBinary,truncated}
//   session_finished — финал сессии
export type LiveEventKind =
  | 'assistant_text'
  | 'tool_use'
  | 'file_edit'
  | 'file_write'
  | 'bash'
  | 'tool_error'
  | 'diff_summary'
  | 'file_diff'
  | 'session_finished';

// payload-форма для file_edit (hunks: было→стало по каждому Edit).
export type LiveFileEditPayload = {
  readonly path: string;
  readonly edits: ReadonlyArray<{ readonly old: string; readonly new: string }>;
};

// payload-форма для file_write (полный файл).
export type LiveFileWritePayload = {
  readonly path: string;
  readonly content: string;
};

// payload-форма для bash.
export type LiveBashPayload = {
  readonly command: string;
};

// payload-форма для tool_use (прочие инструменты).
export type LiveToolUsePayload = {
  readonly name: string;
  readonly brief?: string;
};

// payload-форма для diff_summary (сводка в конце сессии).
export type LiveDiffSummaryPayload = {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly change: LiveFileChange;
    readonly additions: number;
    readonly deletions: number;
  }>;
};

// Тип изменения файла в финальном git-диффе.
export type LiveFileChange = 'added' | 'modified' | 'deleted' | 'renamed';

export type LiveEvent = {
  readonly seq: number;
  // Строка (не union) — forward-compat: новые виды не должны валить старый UI.
  readonly kind: LiveEventKind | (string & {});
  // Сырой текст события (assistant_text / tool_error и т.п.). NULL для структурных.
  readonly text: string | null;
  // Структурированный payload конкретного вида (см. *Payload типы выше). unknown —
  // narrow'им на рендере по kind.
  readonly payload: unknown;
  readonly createdAt: Date;
};
