import { useEffect, useRef, type RefObject } from 'react';

type Opts = {
  // Тонкая полоса-ловушка у левого края экрана (жест «открыть»). Non-passive обработчик
  // на ней блокирует скролл доски во время свайпа.
  edgeRef: RefObject<HTMLElement | null>;
  // Жест активен только на мобиле (передаём !isDesktop).
  enabled: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  // Порог горизонтального смещения, после которого панель открывается/закрывается (px).
  thresholdPx?: number;
};

// iPhone-style edge-swipe для мобильной левой панели:
//   • тянешь ОТ САМОГО ЛЕВОГО КРАЯ вправо → панель открывается (доска при этом НЕ скроллится,
//     т.к. жест начинается на полосе-ловушке и мы preventDefault'им горизонталь);
//   • свайп ВЛЕВО когда открыта → закрывается.
// Направление определяется по первым ~8px: горизонталь → перехватываем (открытие),
// вертикаль → отпускаем (обычный скролл страницы работает).
export function useEdgeSwipe({
  edgeRef,
  enabled,
  open,
  onOpen,
  onClose,
  thresholdPx = 44,
}: Opts): void {
  const ref = useRef({ open, onOpen, onClose });
  useEffect(() => {
    ref.current = { open, onOpen, onClose };
  });

  // ОТКРЫТИЕ — с полосы-ловушки у левого края. Non-passive: preventDefault горизонтали
  // не даёт доске прокрутиться под пальцем.
  useEffect(() => {
    const el = edgeRef.current;
    if (!enabled || !el) return;

    let sx = 0;
    let sy = 0;
    let dir = 0; // 0 — не решено, 1 — горизонталь, -1 — вертикаль
    let opened = false;

    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      sx = t.clientX;
      sy = t.clientY;
      dir = 0;
      opened = false;
    };
    const onMove = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (dir === 0) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) dir = 1;
        else if (Math.abs(dy) > 8) {
          dir = -1;
          return;
        } else return;
      }
      if (dir !== 1) return; // вертикальный скролл не трогаем
      e.preventDefault(); // блокируем горизонтальный скролл доски
      if (!opened && dx > thresholdPx) {
        opened = true;
        ref.current.onOpen();
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, [edgeRef, enabled, thresholdPx]);

  // ЗАКРЫТИЕ — свайп влево, когда панель открыта (по всему окну, passive).
  useEffect(() => {
    if (!enabled) return;
    let sx = 0;
    let sy = 0;
    let tracking = false;
    let done = false;
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0]!;
      sx = t.clientX;
      sy = t.clientY;
      tracking = true;
      done = false;
    };
    const onMove = (e: TouchEvent): void => {
      if (!tracking || done || !ref.current.open) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (dx < -thresholdPx && Math.abs(dx) > Math.abs(dy)) {
        done = true;
        ref.current.onClose();
      }
    };
    const onEnd = (): void => {
      tracking = false;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, thresholdPx]);
}
