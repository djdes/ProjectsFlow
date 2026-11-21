// Short vibration on touch confirmations (Android Chrome; iOS Safari has no Vibration API and
// silently ignores it). Off when the person turned motion off or the system asks for less.
const PATTERN: Record<'tap' | 'success' | 'warning', number | number[]> = { tap: 8, success: [10, 40, 18], warning: 24 };

export type HapticKind = keyof typeof PATTERN;

export function haptic(kind: HapticKind = 'tap'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (document.documentElement.classList.contains('pf-no-motion')) return;
    if (!matchMedia('(pointer: coarse)').matches) return;
    navigator.vibrate(PATTERN[kind]);
  } catch {
    /* vibration is a nicety — never let it break an action */
  }
}
