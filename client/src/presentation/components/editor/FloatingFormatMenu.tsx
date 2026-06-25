import * as React from 'react';
import type { Editor } from '@tiptap/react';

import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { FormatMenu } from './FormatMenu';

// Якорь меню в координатах вьюпорта (как от `view.coordsAtPos` / события мыши).
export interface FloatingAnchor {
  /** Левый край выделения / точка клика. */
  x: number;
  /** Верх выделения (предпочтительно ставим меню НАД ним). */
  top: number;
  /** Низ выделения (фолбэк — ставим ПОД ним, если сверху не помещается). */
  bottom: number;
}

const PAD = 8; // отступ от краёв вьюпорта

// Ближайший предок, создающий containing-block для position:fixed (transform / filter
// / perspective / will-change). Внутри Sheet (slide-анимация оставляет такой предок)
// fixed считается от него, а не от вьюпорта — поэтому координаты надо сместить на его
// origin. null — фиксед считается от вьюпорта (обычный случай).
function fixedContainingBlock(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const s = getComputedStyle(p);
    if (
      s.transform !== 'none' ||
      s.perspective !== 'none' ||
      (s.filter && s.filter !== 'none') ||
      s.willChange.includes('transform')
    ) {
      return p;
    }
    p = p.parentElement;
  }
  return null;
}

// Плавающее меню форматирования (по выделению И по правому клику). В отличие от
// Tiptap BubbleMenu / Radix Popover — полностью самоуправляемое: `position: fixed`,
// клампится по вьюпорту (цвет/преобразование-панели НИКОГДА не уезжают в угол 0,0 —
// это та же коробка), закрывается по Escape / уходу выделения.
//
// ВАЖНО: рендерим IN-TREE (без портала в body). Дровер — это Sheet (Radix Dialog) с
// focus-trap'ом; меню-портал в body оказывался ВНЕ диалога, и Radix синхронно
// возвращал фокус в диалог при первом же pointerdown по кнопке меню — выделение
// схлопывалось, меню рушилось. Внутри поддерева диалога focus-trap не мешает, а
// `position: fixed` всё равно выходит за overflow-обрезку.
export function FloatingFormatMenu({
  editor,
  anchor,
  onClose,
  getRange,
}: {
  editor: Editor;
  anchor: FloatingAnchor | null;
  onClose: () => void;
  /** Снимок диапазона выделения на момент открытия (восстанавливается перед командой). */
  getRange?: () => { from: number; to: number } | null;
}): React.ReactElement | null {
  const { animations } = useMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number; ready: boolean }>({
    left: 0,
    top: 0,
    ready: false,
  });

  // Пересчёт позиции с клампом по вьюпорту. Зовём на смену якоря и на ресайз меню
  // (панели «Цвет»/«Преобразовать» выше главной — высота меняется).
  const place = React.useCallback(() => {
    if (!anchor || !ref.current) return;
    const m = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 1) Желаемая позиция в координатах ВЬЮПОРТА (anchor — viewport-coords).
    let vpLeft = anchor.x;
    if (vpLeft + m.width > vw - PAD) vpLeft = vw - PAD - m.width;
    if (vpLeft < PAD) vpLeft = PAD;
    // Предпочтительно НАД выделением; не влезает сверху — ПОД ним.
    let vpTop = anchor.top - m.height - PAD;
    if (vpTop < PAD) vpTop = anchor.bottom + PAD;
    if (vpTop + m.height > vh - PAD) vpTop = Math.max(PAD, vh - PAD - m.height);
    // 2) Перевод в координаты containing-block'а (если fixed «пойман» transform-предком).
    const cb = fixedContainingBlock(ref.current);
    const origin = cb ? cb.getBoundingClientRect() : { left: 0, top: 0 };
    setPos({ left: vpLeft - origin.left, top: vpTop - origin.top, ready: true });
  }, [anchor]);

  React.useLayoutEffect(() => {
    setPos((p) => ({ ...p, ready: false }));
    place();
  }, [place]);

  // Меню меняет высоту при переходе на панель «Цвет»/«Преобразовать» — переклампим.
  React.useEffect(() => {
    if (!anchor || !ref.current) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [anchor, place]);

  // Escape закрывает; уход выделения обрабатывается на стороне RichTextEditor.
  React.useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [anchor, onClose]);

  if (!anchor) return null;

  return (
    <div
      ref={ref}
      data-format-menu
      // mousedown внутри меню не должен уводить фокус из редактора (иначе слетит
      // выделение) — отдельные кнопки уже делают preventDefault, но подстрахуемся.
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        visibility: pos.ready ? 'visible' : 'hidden',
        maxHeight: `calc(100vh - ${PAD * 2}px)`,
      }}
      className={cn(
        'z-[70] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-none',
        animations && 'animate-in fade-in-0 zoom-in-95',
      )}
    >
      <FormatMenu editor={editor} onAction={onClose} getRange={getRange} />
    </div>
  );
}
