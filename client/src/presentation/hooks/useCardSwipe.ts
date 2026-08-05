import { useEffect, useRef, useState } from 'react';

// Насколько далеко надо утащить карточку, чтобы жест сработал. Меньше — срабатывает
// случайно при скролле пальцем, больше — на узком телефоне до порога не дотянуться.
const COMMIT_PX = 96;
// С какого смещения считаем жест горизонтальным и берём его на себя. До этого порога
// палец ещё может уйти в вертикальный скролл страницы, и мешать ему нельзя.
const CLAIM_PX = 12;
// Во сколько раз горизонталь должна превышать вертикаль, чтобы это был свайп, а не скролл.
const DOMINANCE = 1.5;

type Options = {
  // Жест выключён (нет прав / идёт другое взаимодействие) — обработчики не вешаются.
  readonly disabled?: boolean;
  // Палец отпущен за порогом.
  readonly onCommit: () => void;
};

type Result = {
  // Ref на элемент карточки: на него вешаются touch-обработчики.
  readonly ref: (node: HTMLElement | null) => void;
  // Текущее смещение в px (0 — жеста нет). Рисуется CSS-transform'ом, БЕЗ framer-motion:
  // на тач-устройствах framer-обёртка карточек отключена ради производительности.
  readonly offset: number;
  // Порог пройден — подложка должна показать, что отпускание сработает.
  readonly armed: boolean;
};

/**
 * Горизонтальный свайп по карточке на тач-устройствах.
 *
 * Уживается с уже существующими жестами:
 *  • dnd-kit TouchSensor активируется по удержанию (delay 220мс, tolerance 8px) — быстрый
 *    свайп уводит палец дальше tolerance и drag просто не стартует;
 *  • document-level useEdgeSwipe (сайдбар) пропускает зоны с `data-pf-no-edge-swipe` —
 *    его ставит вызывающий на контейнер карточки;
 *  • вертикальный скролл страницы: пока жест не признан горизонтальным (CLAIM_PX +
 *    доминирование по оси), мы ничего не перехватываем и не зовём preventDefault.
 *
 * Слушатели вешаются вручную (не через React-пропсы), потому что touchmove нужен
 * НЕпассивным — иначе preventDefault не отменит прокрутку.
 */
export function useCardSwipe({ disabled = false, onCommit }: Options): Result {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [offset, setOffset] = useState(0);
  // Коллбек в ref: пересоздавать слушатели на каждый ре-рендер карточки не нужно.
  // Запись только в эффекте — писать в ref во время рендера нельзя (react-hooks/refs).
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (!node || disabled) return;

    let startX = 0;
    let startY = 0;
    let claimed = false;
    let active = false;
    let dx = 0;

    const reset = (): void => {
      active = false;
      claimed = false;
      dx = 0;
      setOffset(0);
    };

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        reset();
        return;
      }
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
      active = true;
      claimed = false;
      dx = 0;
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (!active || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!claimed) {
        // Вертикальное движение — отдаём жест скроллу и больше не вмешиваемся.
        if (Math.abs(dy) > Math.abs(dx) * DOMINANCE && Math.abs(dy) > CLAIM_PX) {
          active = false;
          return;
        }
        if (Math.abs(dx) < CLAIM_PX || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
        claimed = true;
      }
      // Жест наш — гасим прокрутку страницы, иначе карточка едет вместе с ней.
      e.preventDefault();
      // Тянем только вправо: «дальше по процессу». Влево — ничего, чтобы жест не
      // читался как «отменить» и не требовал второго смысла.
      setOffset(Math.max(0, dx));
    };

    const onTouchEnd = (): void => {
      if (claimed && dx >= COMMIT_PX) commitRef.current();
      reset();
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', reset);
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', reset);
    };
  }, [node, disabled]);

  return { ref: setNode, offset, armed: offset >= COMMIT_PX };
}
