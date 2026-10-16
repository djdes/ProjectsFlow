import { useEffect, useState } from 'react';

export type ScrollEdges = { readonly back: boolean; readonly forward: boolean };

const NONE: ScrollEdges = { back: false, forward: false };

// Можно ли листать ряд колонок назад/вперёд — для кнопок ‹ › в шапке очереди. Состояние
// живёт в самой шапке: раньше его держал весь блок «Входящих», и на каждом пересечении края
// при прокрутке вбок перерисовывались все колонки с карточками — прокрутка подвисала.
export function useScrollEdges(target: HTMLElement | null): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);

  useEffect(() => {
    if (!target) {
      setEdges(NONE);
      return;
    }
    const measure = (): void => {
      const back = target.scrollLeft > 2;
      const forward = target.scrollLeft + target.clientWidth < target.scrollWidth - 2;
      setEdges((prev) => (prev.back === back && prev.forward === forward ? prev : { back, forward }));
    };
    measure();
    target.addEventListener('scroll', measure, { passive: true });
    // Ширина ряда меняется с окном и составом колонок.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const observeColumns = (): void => {
      if (!ro) return;
      ro.observe(target);
      for (const child of Array.from(target.children)) ro.observe(child);
    };
    observeColumns();
    const mo = new MutationObserver(() => {
      observeColumns();
      measure();
    });
    mo.observe(target, { childList: true });
    return () => {
      target.removeEventListener('scroll', measure);
      ro?.disconnect();
      mo.disconnect();
    };
  }, [target]);

  return edges;
}
