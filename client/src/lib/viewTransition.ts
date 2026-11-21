// Tab switches on a phone use the View Transitions API (react-router `viewTransition`): the
// page content lifts in while the header and tab bar, which have their own transition names,
// stay put. PageTransition's own fade is skipped right after such a navigation so the two
// animations do not stack.
let lastViewTransitionAt = 0;

/** Whether this navigation should run as a view transition (supported and motion allowed). */
export function wantsViewTransition(): boolean {
  if (typeof document === 'undefined' || !('startViewTransition' in document)) return false;
  if (document.documentElement.classList.contains('pf-no-motion')) return false;
  lastViewTransitionAt = performance.now();
  return true;
}

/** True within a short window after a view-transition navigation began. */
export function viewTransitionRecently(now: number = performance.now()): boolean {
  return now - lastViewTransitionAt < 500;
}
