import type { LiveFileEditPayload } from './LiveEvent';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

// Older dispatchers may send tool-native field names or omit the edit body.
export function parseFileEditPayload(value: unknown): LiveFileEditPayload | null {
  const payload = record(value);
  if (!payload) return null;
  const path = payload.path ?? payload.file_path;
  if (typeof path !== 'string' || !path.trim()) return null;
  const edits: Array<{ old: string; new: string }> = [];
  for (const value of Array.isArray(payload.edits) ? payload.edits : [payload]) {
    const edit = record(value);
    if (!edit) continue;
    const before = edit.old ?? edit.old_string;
    const after = edit.new ?? edit.new_string;
    if (typeof before !== 'string' || typeof after !== 'string' || before === after) continue;
    edits.push({ old: before, new: after });
  }
  return { path, edits };
}
