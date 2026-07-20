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
  // Порог горизонтального смещения, после которого жест срабатывает СРАЗУ (px).
  thresholdPx?: number;
};

// iPhone-style edge-swipe для мобильного drawer (левая панель):
//   • свайп от ЛЕВОГО КРАЯ вправо  → открыть панель;
//   • свайп ВЛЕВО (когда открыта)  → закрыть.
// Срабатывает ПРЯМО ВО ВРЕМЯ движения (на touchmove), как только палец прошёл порог —
// панель реагирует мгновенно, не дожидаясь отпускания пальца. Слушатели пассивные, ничего
// не preventDefault'им; вертикальный скролл и горизонтальный скролл доски (жест не от края
// / вертикально-доминантный) не затрагиваются.
export function useEdgeSwipe({
  enabled,
  open,
  onOpen,
  onClose,
  edgePx = 30,
  thresholdPx = 40,
}: Opts): void {
  // Свежие значения в ref — чтобы не переподписывать слушатели на каждый рендер.
  const ref = useRef({ open, onOpen, onClose });
  useEffect(() => {
    ref.current = { open, onOpen, onClose };
  });

  useEffect(() => {
    if (!enabled) return;

    let startX = 0;
    let startY = 0;
    let fromEdge = false;
    let tracking = false;
    let fired = false; // один срабат на жест

    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
      fromEdge = startX <= edgePx;
      tracking = true;
      fired = false;
    };

    const onMove = (e: TouchEvent): void => {
      if (!tracking || fired) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Преимущественно горизонтальное движение, иначе это скролл — не трогаем.
      if (Math.abs(dx) < Math.abs(dy)) return;
      if (Math.abs(dx) < thresholdPx) return;

      const s = ref.current;
      if (!s.open && fromEdge && dx > 0) {
        fired = true;
        s.onOpen();
      } else if (s.open && dx < 0) {
        fired = true;
        s.onClose();
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
  }, [enabled, edgePx, thresholdPx]);
}
