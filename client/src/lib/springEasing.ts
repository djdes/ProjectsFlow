// The spring curve of the design (--pf-spring in styles/motion.css, written as linear()) for
// Web Animations: one source for CSS and JS springs. Falls back to the ease-out curve where the
// browser has no linear() easing.

const FALLBACK = 'cubic-bezier(0.22, 1, 0.36, 1)';
let cached: string | null = null;

export function springEasing(): string {
  if (cached) return cached;
  if (typeof document === 'undefined') return FALLBACK;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--pf-spring').trim();
  const supported = value.startsWith('linear(') && typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', value);
  cached = supported ? value : FALLBACK;
  return cached;
}
