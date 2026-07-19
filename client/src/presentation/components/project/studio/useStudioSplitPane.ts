import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 560;
const STORAGE_KEY = 'pf:project-studio:chat-width';

// Ширину панели держим в CSS-переменной, а не только в React-стейте. Во время
// перетаскивания это принципиально: setState на каждый pointermove перерисовывал всю
// панель вместе с деревом чата, из-за чего ресайз ощутимо лагал. Теперь при драге мы
// пишем только переменную (кадр в rAF), а React-стейт обновляем один раз — на отпускании.
const CSS_VAR = '--pf-studio-chat-width';
// Плавность сворачивания панели нужна, но во время драга она вредна: ширина должна идти
// за курсором кадр в кадр. Держим её отдельной переменной и гасим императивно прямо в
// pointerdown — если полагаться на React-стейт `dragging`, первые кадры движения успевают
// уехать в 500-миллисекундную анимацию, и рывок читается как лаг.
const TRANSITION_VAR = '--pf-studio-chat-transition';
const PANE_TRANSITION = 'width 500ms cubic-bezier(0.4, 0, 0.2, 1)';

function applyWidthVar(px: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(CSS_VAR, `${px}px`);
}

function applyTransitionVar(value: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(TRANSITION_VAR, value);
}

function clampWidth(value: number): number {
  const viewportMaximum = typeof window === 'undefined'
    ? MAX_WIDTH
    : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 480));
  return Math.min(viewportMaximum, Math.max(MIN_WIDTH, Math.round(value)));
}

function loadWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) ? clampWidth(stored) : DEFAULT_WIDTH;
}

export type StudioSplitPane = {
  readonly width: number;
  readonly hidden: boolean;
  readonly dragging: boolean;
  readonly paneStyle: React.CSSProperties;
  readonly contentStyle: React.CSSProperties;
  readonly separatorProps: React.HTMLAttributes<HTMLDivElement> & {
    role: 'separator';
    tabIndex: number;
    'aria-orientation': 'vertical';
    'aria-label': string;
    'aria-valuemin': number;
    'aria-valuemax': number;
    'aria-valuenow': number;
  };
  readonly setHidden: (hidden: boolean) => void;
  readonly toggle: () => void;
};

export function useStudioSplitPane(): StudioSplitPane {
  const [width, setWidth] = useState(loadWidth);
  const [hidden, setHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  const frameRef = useRef<number | null>(null);

  useEffect(() => { widthRef.current = width; }, [width]);

  // Синхронизируем переменную со стейтом при монтировании и при «дискретных» изменениях
  // (клавиатура, resize окна, double-click). При драге переменную ведёт сам обработчик.
  useEffect(() => { applyWidthVar(width); }, [width]);

  useEffect(() => {
    const onResize = (): void => setWidth((current) => clampWidth(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  const commitWidth = useCallback((next: number): void => {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    applyWidthVar(clamped);
    setWidth(clamped);
    try { window.localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* storage is optional */ }
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (hidden || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    setDragging(true);

    // Справа живёт iframe превью. Стоит курсору при быстром движении заехать на него —
    // iframe забирает pointer-события себе, наши window-слушатели замолкают и панель
    // «отваливается» от курсора. Лечим двумя независимыми способами, потому что каждый
    // по отдельности в разных браузерах даёт осечки:
    //   1) pointer capture — события продолжают адресоваться разделителю поверх iframe;
    //   2) на время драга отключаем pointer-events у всех iframe на странице.
    const separator = event.currentTarget;
    applyTransitionVar('none');
    try { separator.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
    const frames = [...document.querySelectorAll('iframe')];
    const restoreFrames = frames.map((frame) => {
      const previous = frame.style.pointerEvents;
      frame.style.pointerEvents = 'none';
      return () => { frame.style.pointerEvents = previous; };
    });

    // Во время драга НЕ дёргаем setState и localStorage — только CSS-переменную, не чаще
    // кадра. Иначе каждое движение мыши перерисовывало панель с чатом и писало на диск.
    const onMove = (moveEvent: PointerEvent): void => {
      const next = clampWidth(startWidth + moveEvent.clientX - startX);
      widthRef.current = next;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        applyWidthVar(widthRef.current);
      });
    };
    const onEnd = (): void => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      restoreFrames.forEach((restore) => restore());
      applyTransitionVar(PANE_TRANSITION);
      try { separator.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      setDragging(false);
      // Единственная за весь драг синхронизация стейта и localStorage.
      commitWidth(widthRef.current);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, [commitWidth, hidden]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = widthRef.current - (event.shiftKey ? 48 : 16);
    if (event.key === 'ArrowRight') next = widthRef.current + (event.shiftKey ? 48 : 16);
    if (event.key === 'Home') next = MIN_WIDTH;
    if (event.key === 'End') next = MAX_WIDTH;
    if (next === null) return;
    event.preventDefault();
    commitWidth(next);
  }, [commitWidth]);

  const separatorProps = useMemo<StudioSplitPane['separatorProps']>(() => ({
    role: 'separator',
    tabIndex: hidden ? -1 : 0,
    'aria-orientation': 'vertical',
    'aria-label': 'Изменить ширину AI-чата',
    'aria-valuemin': MIN_WIDTH,
    'aria-valuemax': MAX_WIDTH,
    'aria-valuenow': width,
    onPointerDown,
    onKeyDown,
    onDoubleClick: () => commitWidth(DEFAULT_WIDTH),
  }), [commitWidth, hidden, onKeyDown, onPointerDown, width]);

  return {
    width,
    hidden,
    dragging,
    paneStyle: {
      width: hidden ? 0 : `var(${CSS_VAR}, ${DEFAULT_WIDTH}px)`,
      transition: `var(${TRANSITION_VAR}, ${PANE_TRANSITION})`,
    },
    // Внутреннее содержимое держит ширину само, чтобы при сворачивании панели текст
    // не переливался. Тоже от переменной — иначе драг снова упрётся в ре-рендер.
    contentStyle: { width: `var(${CSS_VAR}, ${DEFAULT_WIDTH}px)` },
    separatorProps,
    setHidden,
    toggle: () => setHidden((current) => !current),
  };
}
