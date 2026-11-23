import type { RequestHandler } from 'express';

type Deps = {
  // Runs the rest of the request inside a fresh memo that serves while `active()` is true
  // (RequestMemo.run).
  readonly run: (active: () => boolean, next: () => void) => void;
};

/**
 * Opens a per-request memo for read-only permission lookups (RequestMemo): the inbox lists
 * check the same projects for every task, and a read request does not change the answers.
 *
 * - GET/HEAD only: a write may change the very permission it has just read (a member removed,
 *   a project hidden), so writes keep reading the database every time.
 * - The memo stops serving once the response has started. Streams (SSE) send their headers
 *   first and then check access per event, and work that outlives the response (notifications,
 *   background follow-ups) checks later — both must see a revoked access at once.
 */
export function requestMemoScope(deps: Deps): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    deps.run(() => !res.headersSent, next);
  };
}
