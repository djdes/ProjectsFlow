import { useEffect } from 'react';
import { keyboardInset } from '@/lib/keyboardInset';

/**
 * Publishes the on-screen keyboard as `--pf-keyboard` (px) and `data-pf-keyboard` on <html>.
 * iOS keeps the layout viewport when the keyboard opens, so fixed bottom chrome (tab bar)
 * would ride above the keyboard and eat the space; CSS hides it while the attribute is set.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    // Android with interactive-widget=resizes-content shrinks the layout viewport itself, so
    // visualViewport matches innerHeight there: compare with the height before typing began.
    let baseline = window.innerHeight;
    const editing = (): boolean =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.matches('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!editing()) baseline = window.innerHeight;
        const inset = Math.max(
          keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop),
          editing() ? keyboardInset(baseline, window.innerHeight, 0) : 0,
        );
        root.style.setProperty('--pf-keyboard', `${inset}px`);
        if (inset > 0) root.dataset.pfKeyboard = '';
        else delete root.dataset.pfKeyboard;
      });
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusout', update);
      delete root.dataset.pfKeyboard;
    };
  }, []);
}
