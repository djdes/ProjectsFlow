import { useEffect, useState } from 'react';
import { nextScrollHidden } from '@/lib/scrollHide';

/** True while the main scroller ([data-pf-main]) is being scrolled down (lib/scrollHide). */
export function useHideOnScroll(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    const scroller = document.querySelector<HTMLElement>('[data-pf-main]');
    if (!scroller) return;
    let last = scroller.scrollTop;
    let state = false;
    const onScroll = (): void => {
      const top = scroller.scrollTop;
      const next = nextScrollHidden(state, last, top);
      last = top;
      if (next !== state) {
        state = next;
        setHidden(next);
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [enabled]);
  return hidden;
}
