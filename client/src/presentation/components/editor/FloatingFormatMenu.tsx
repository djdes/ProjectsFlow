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
  // Самокорректирующееся позиционирование: anchor в координатах ВЬЮПОРТА, но fixed
  // внутри Sheet считается от его transform-border-box (а не от вьюпорта). Меряем, где
  // меню реально оказалось при текущем style.left/top, и сдвигаем на дельту до желаемой
  // viewport-позиции. Работает при любом containing-block без его поиска.
  const place = React.useCallback(() => {
    const el = ref.current;
    if (!anchor || !el) return;
    const styleLeft = parseFloat(el.style.left) || 0;
    const styleTop = parseFloat(el.style.top) || 0;
    const m = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let vpLeft = anchor.x;
    if (vpLeft + m.width > vw - PAD) vpLeft = vw - PAD - m.width;
    if (vpLeft < PAD) vpLeft = PAD;
    // Предпочтительно НАД выделением; не влезает сверху — ПОД ним.
    let vpTop = anchor.top - m.height - PAD;
    if (vpTop < PAD) vpTop = anchor.bottom + PAD;
    if (vpTop + m.height > vh - PAD) vpTop = Math.max(PAD, vh - PAD - m.height);
    const nextLeft = styleLeft + (vpLeft - m.left);
    const nextTop = styleTop + (vpTop - m.top);
    if (Math.abs(nextLeft - styleLeft) < 0.5 && Math.abs(nextTop - styleTop) < 0.5) {
      setPos((p) => ({ ...p, ready: true }));
      return;
    }
    setPos({ left: nextLeft, top: nextTop, ready: true });
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
      {/* onAction НЕ передаём: меню остаётся открытым после применения формата
          (закрытие — Escape / клик вне / смена выделения). */}
      <FormatMenu editor={editor} getRange={getRange} />
    </div>
  );
}
