// Tab switches on a phone use the View Transitions API (react-router `viewTransition`): the
// page content lifts in while the header and tab bar, which have their own transition names,
// stay put. PageTransition's own fade is skipped right after such a navigation so the two
// animations do not stack.
let lastViewTransitionAt = 0;

/** Kind of tab switch: the AI tab slides up like a sheet and slides back down when left. */
export function viewTransitionKind(to: string, from: string): 'ai-open' | 'ai-close' | 'tab' {
  const isAi = (path: string): boolean => path === '/ai' || path.startsWith('/ai/') || path.startsWith('/ai?');
  if (isAi(to) && !isAi(from)) return 'ai-open';
  if (!isAi(to) && isAi(from)) return 'ai-close';
  return 'tab';
}

/** Whether this navigation should run as a view transition (supported and motion allowed). */
export function wantsViewTransition(to = '', from = ''): boolean {
  if (typeof document === 'undefined' || !('startViewTransition' in document)) return false;
  if (document.documentElement.classList.contains('pf-no-motion')) return false;
  lastViewTransitionAt = performance.now();
  // Read by globals.css (html[data-pf-vt]) to pick the animation of this switch.
  document.documentElement.dataset.pfVt = viewTransitionKind(to, from);
  return true;
}

/** True within a short window after a view-transition navigation began. */
export function viewTransitionRecently(now: number = performance.now()): boolean {
  return now - lastViewTransitionAt < 500;
}
