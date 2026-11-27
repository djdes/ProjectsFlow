import { useEffect } from 'react';
import { hasKeyboardFocus, keyboardInset } from '@/lib/keyboardInset';

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
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const editing = hasKeyboardFocus();
        if (!editing) baseline = window.innerHeight;
        const inset = editing && viewport.scale <= 1.01 ? Math.max(
          keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop),
          keyboardInset(baseline, window.innerHeight, 0),
        ) : 0;
        root.style.setProperty('--pf-keyboard', `${inset}px`);
        if (inset > 0) root.dataset.pfKeyboard = '';
        else delete root.dataset.pfKeyboard;
      });
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      delete root.dataset.pfKeyboard;
    };
  }, []);
}
