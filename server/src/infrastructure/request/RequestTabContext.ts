import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

const TAB_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * Per-request origin tab identifier (`X-Tab-Id` header). Used so SSE `task_changed` echoes carry
 * `sourceTabId` and the originating browser tab can skip redundant self-echo refetches while
 * other tabs, devices and colleagues still refresh immediately.
 */
export class RequestTabContext {
  private readonly storage = new AsyncLocalStorage<string | null>();

  run(tabId: string | null, next: () => void): void {
    this.storage.run(tabId, next);
  }

  current(): string | null {
    return this.storage.getStore() ?? null;
  }
}

export const requestTabContext = new RequestTabContext();

export function requestTabScope(context: RequestTabContext = requestTabContext): RequestHandler {
  return (req, _res, next) => {
    const raw = req.get('x-tab-id');
    const tabId = raw && TAB_ID_PATTERN.test(raw) ? raw : null;
    if (!tabId) {
      next();
      return;
    }
    context.run(tabId, next);
  };
}
