import { useEffect, useRef } from 'react';

type Opts = {
  // Жест активен только на мобиле (передаём !isDesktop).
  enabled: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  // Ширина «краевой» зоны у левого/правого края экрана (px).
  edgePx?: number;
  // Порог горизонтального смещения для открытия/закрытия (px).
  thresholdPx?: number;
};

// iPhone-style edge-swipe + ЖЁСТКАЯ блокировка системного свайпа «назад/вперёд».
// Слушатели на document (не полоса-ловушка): touchmove НЕ passive, чтобы preventDefault
// гасил iOS-жест истории (в standalone PWA он иначе не отключается — overscroll-behavior
// на iOS ненадёжен). Логика:
//   • свайп ГОРИЗОНТАЛЬНО, начатый у ЛЕВОГО или ПРАВОГО края → preventDefault (нет back/forward);
//   • у левого края вправо → открыть панель; когда открыта, свайп влево → закрыть.
// Перф: для НЕ-краевых касаний обработчик выходит первой же строкой (edge === null) —
// обычный вертикальный/горизонтальный скролл контента не затронут.
export function useEdgeSwipe({
  enabled,
  open,
  onOpen,
  onClose,
  edgePx = 28,
  thresholdPx = 44,
}: Opts): void {
  const ref = useRef({ open, onOpen, onClose });
  useEffect(() => {
    ref.current = { open, onOpen, onClose };
  });

  useEffect(() => {
    if (!enabled) return;

    let sx = 0;
    let sy = 0;
    let edge: 'left' | 'right' | null = null;
    let dir = 0; // 0 — не решено, 1 — горизонталь, -1 — вертикаль
    let fired = false;

    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        edge = null;
        return;
      }
      const t = e.touches[0]!;
      sx = t.clientX;
      sy = t.clientY;
      dir = 0;
      fired = false;
      const w = window.innerWidth;
      // Открытая панель: весь экран — зона жеста «закрыть влево».
      if (ref.current.open) edge = 'left';
      else if (sx <= edgePx) edge = 'left';
      else if (sx >= w - edgePx) edge = 'right';
      else edge = null;
    };

    const onMove = (e: TouchEvent): void => {
      if (edge === null) return; // не краевой жест — не мешаем (дёшево)
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (dir === 0) {
        if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) dir = 1;
        else if (Math.abs(dy) > 6) {
          edge = null; // вертикаль — отдаём странице обычный скролл
          return;
        } else return;
      }
      // Горизонтальный краевой жест — гасим системный back/forward.
      e.preventDefault();
      if (fired) return;
      const s = ref.current;
      if (!s.open && edge === 'left' && dx > thresholdPx) {
        fired = true;
        s.onOpen();
      } else if (s.open && dx < -thresholdPx) {
        fired = true;
        s.onClose();
      }
    };

    const onEnd = (): void => {
      edge = null;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, edgePx, thresholdPx]);
}
