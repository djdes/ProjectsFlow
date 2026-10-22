export type WorkerSessionMode = 'continue' | 'new';
export const NEW_WORKER_SESSION_MARKER = '<!-- ralph-session:new -->';

// Stored on a human comment, alongside the prompt it applies to. The dispatcher
// accepts this control only when the server identifies its actor as a real user.
export function workerSessionPrompt(body: string, mode: WorkerSessionMode): string {
  return mode === 'new' ? `${NEW_WORKER_SESSION_MARKER}\n${body}` : body;
}
