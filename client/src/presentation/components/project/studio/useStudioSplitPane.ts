import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 560;
const STORAGE_KEY = 'pf:project-studio:chat-width';

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

  useEffect(() => { widthRef.current = width; }, [width]);

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
    setWidth(clamped);
    try { window.localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* storage is optional */ }
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (hidden || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    setDragging(true);

    const onMove = (moveEvent: PointerEvent): void => {
      commitWidth(startWidth + moveEvent.clientX - startX);
    };
    const onEnd = (): void => {
      setDragging(false);
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
      width: hidden ? 0 : width,
      transition: dragging ? 'none' : 'width 500ms cubic-bezier(0.4, 0, 0.2, 1)',
    },
    separatorProps,
    setHidden,
    toggle: () => setHidden((current) => !current),
  };
}
