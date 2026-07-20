import { useEffect, useRef } from 'react';

type Opts = {
  // Жест активен только на мобиле (передаём !isDesktop). На десктопе слушатели не вешаем.
  enabled: boolean;
  // Открыт ли сейчас drawer (нужно, чтобы отличать «открыть» от «закрыть»).
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  // Зона у левого края экрана, из которой засчитывается жест «открыть» (px).
  edgePx?: number;
  // Минимальное горизонтальное смещение, чтобы жест сработал (px).
  minDistPx?: number;
};

// iPhone-style edge-swipe для мобильного drawer (левая панель):
//   • свайп от ЛЕВОГО КРАЯ вправо  → открыть панель;
//   • свайп ВЛЕВО (когда открыта)  → закрыть.
// Слушатели пассивные, ничего не preventDefault'им — вертикальный скролл, клики и
// горизонтальный скролл доски (жест начинается не от края) не затрагиваются.
export function useEdgeSwipe({
  enabled,
  open,
  onOpen,
  onClose,
  edgePx = 24,
  minDistPx = 56,
}: Opts): void {
  // Свежие значения в ref — чтобы не переподписывать слушатели на каждый рендер.
  // Обновляем в эффекте (не во время рендера): слушатели читают ref.current в момент жеста.
  const ref = useRef({ open, onOpen, onClose });
  useEffect(() => {
    ref.current = { open, onOpen, onClose };
  });

  useEffect(() => {
    if (!enabled) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let fromEdge = false;
    let tracking = false;

    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
      startT = e.timeStamp;
      fromEdge = startX <= edgePx;
      tracking = true;
    };

    const onEnd = (e: TouchEvent): void => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = e.timeStamp - startT;
      // Жест — быстрый и преимущественно горизонтальный, иначе игнор (это скролл/тап).
      if (dt > 700) return;
      if (Math.abs(dx) < minDistPx) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.4) return;

      const s = ref.current;
      if (!s.open && fromEdge && dx > 0) {
        s.onOpen();
      } else if (s.open && dx < 0) {
        s.onClose();
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [enabled, edgePx, minDistPx]);
}
