// Ширина левой панели с ручкой-ресайзом у правого края (desktop).
//
// Источник правды — профиль пользователя (users.ui_prefs.sidebarWidth): одинаков во всех
// пространствах и переживает перезагрузку. localStorage используется как быстрый кэш,
// чтобы применить ширину МГНОВЕННО на первом рендере (без мигания дефолта), пока едет
// серверный prefs-запрос. На отпускании ручки пишем и туда, и туда.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';

export const SIDEBAR_WIDTH_KEY = 'pf_sidebar_width';
export const SIDEBAR_DEFAULT_WIDTH = 270;
// Ниже SIDEBAR_COMPACT_WIDTH подписи у навигации/свитчера скрываются (иконки-only), поэтому
// можно сузить сильнее прежнего минимума — но не в кашу.
export const SIDEBAR_MIN_WIDTH = 176;
export const SIDEBAR_COMPACT_WIDTH = 212;
export const SIDEBAR_MAX_WIDTH = 480;

export function clampSidebarWidth(w: number): number {
  const n = Number.isFinite(w) ? Math.round(w) : SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, n));
}

function readStored(): number | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function writeStored(w: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(w)));
  } catch {
    /* localStorage недоступен — ширина всё равно применится в памяти */
  }
}

export type SidebarWidth = {
  readonly width: number;
  readonly dragging: boolean;
  readonly onHandlePointerDown: (e: React.PointerEvent<HTMLElement>) => void;
};

// onCollapseClick — тап по ручке без перетаскивания = свернуть панель (как в Notion:
// «клик — свернуть, тянуть — ширина»).
export function useSidebarWidth(enabled: boolean, onCollapseClick?: () => void): SidebarWidth {
  const { userRepository } = useContainer();
  const onCollapseClickRef = useRef(onCollapseClick);
  useEffect(() => {
    onCollapseClickRef.current = onCollapseClick;
  }, [onCollapseClick]);
  const [width, setWidth] = useState<number>(() =>
    clampSidebarWidth(readStored() ?? SIDEBAR_DEFAULT_WIDTH),
  );
  const [dragging, setDragging] = useState(false);

  // Профиль — источник правды: при монтировании подтягиваем серверную ширину и применяем.
  useEffect(() => {
    let cancelled = false;
    void userRepository
      .getUiPrefs()
      .then((p) => {
        if (cancelled || typeof p.sidebarWidth !== 'number') return;
        const w = clampSidebarWidth(p.sidebarWidth);
        setWidth(w);
        writeStored(w);
      })
      .catch(() => {
        /* нет сети/prefs — остаёмся на localStorage/дефолте */
      });
    return () => {
      cancelled = true;
    };
  }, [userRepository]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      if (!enabled) return;
      e.preventDefault();
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* capture — best-effort */
      }
      dragRef.current = { startX: e.clientX, startWidth: width };
      let moved = false;
      setDragging(true);

      const onMove = (ev: PointerEvent): void => {
        const d = dragRef.current;
        if (!d) return;
        if (Math.abs(ev.clientX - d.startX) > 3) moved = true;
        // Ручка на ПРАВОМ крае панели: вправо (больше clientX) = шире, влево = уже.
        const next = clampSidebarWidth(d.startWidth + (ev.clientX - d.startX));
        // Пусть окно задачи, если открыто, знает где правый край панели (взаимный коллапс).
        window.dispatchEvent(new CustomEvent('pf:sidebar-resize', { detail: { width: next } }));
        setWidth(next);
      };
      const onUp = (): void => {
        dragRef.current = null;
        setDragging(false);
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        window.dispatchEvent(new CustomEvent('pf:sidebar-resize-end'));
        // Клик без тяги — свернуть панель; иначе — зафиксировать новую ширину.
        if (!moved) {
          onCollapseClickRef.current?.();
          return;
        }
        setWidth((w) => {
          writeStored(w);
          void userRepository.setUiPrefs({ sidebarWidth: w }).catch(() => {
            /* сохранится хотя бы локально */
          });
          return w;
        });
      };

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [enabled, width, userRepository],
  );

  return { width, dragging, onHandlePointerDown };
}
