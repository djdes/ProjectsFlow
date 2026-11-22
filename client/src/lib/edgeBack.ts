// «Back» for a left-edge swipe on a phone (iOS habit): close the top-most open layer, else
// leave a task page if the app has history to return to. Returns whether it handled the swipe.

/** Top-most open Radix layer (dialog, sheet, menu) — they all close on Escape. */
export function closeTopLayer(doc: Document = document): boolean {
  const open = doc.querySelectorAll('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]');
  if (open.length === 0) return false;
  const target = doc.activeElement instanceof HTMLElement ? doc.activeElement : doc.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  return true;
}

/** A task page reached by in-app navigation (react-router keeps the stack index in state). */
export function canLeaveTaskPage(pathname: string, historyState: unknown): boolean {
  if (!/\/tasks\/[^/]+\/?$/.test(pathname)) return false;
  const idx = (historyState as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}
