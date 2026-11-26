// Random per-tab identifier sent on mutating requests (`X-Tab-Id`) so SSE `task_changed`
// echoes carry `sourceTabId` and this tab can skip duplicate self-echo refetches while
// other tabs, devices and colleagues still refresh immediately.
function generateTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const TAB_ID: string = generateTabId();
