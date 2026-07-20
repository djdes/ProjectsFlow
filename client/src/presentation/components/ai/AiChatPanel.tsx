import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsRight } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { ResizeHandleHint } from '@/presentation/components/layout/ResizeHandleHint';
import { useSetRightPanelWidth } from '@/presentation/layout/rightPanelContext';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { AiConversationView } from './AiConversationView';

// Ширина панели (px), тянется ручкой у левого края; хранится в localStorage.
const PANEL_WIDTH_KEY = 'pf-ai-chat-panel-width';
const PANEL_MIN_WIDTH = 380;
const PANEL_DEFAULT_WIDTH = 560;
function clampPanelWidth(w: number): number {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const max = Math.max(PANEL_MIN_WIDTH, Math.round(vw * 0.95));
  return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(w)));
}

type Props = {
  // null = панель закрыта (беседа ещё не создана).
  conversationId: string | null;
  onOpenChange: (open: boolean) => void;
};

// Правая выезжающая панель с беседой ИИ — открывается кнопкой «Новый чат» внизу сайдбара.
// Немодальна (как окно активности проекта): остальной интерфейс остаётся кликабельным.
export function AiChatPanel({ conversationId, onOpenChange }: Props): React.ReactElement {
  const open = conversationId !== null;

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(PANEL_WIDTH_KEY));
      return clampPanelWidth(Number.isFinite(raw) && raw > 0 ? raw : PANEL_DEFAULT_WIDTH);
    } catch {
      return PANEL_DEFAULT_WIDTH;
    }
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; w: number } | null>(null);

  const isDesktop = useMediaQuery('(min-width: 768px)');
  const setRightPanelWidth = useSetRightPanelWidth();
  useEffect(() => {
    // Только десктоп: на мобиле панель — полноэкранный оверлей, сдвигать соседей не нужно.
    setRightPanelWidth(open && isDesktop ? panelWidth : 0);
    return () => setRightPanelWidth(0);
  }, [setRightPanelWidth, open, isDesktop, panelWidth]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      e.preventDefault();
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
      dragRef.current = { x: e.clientX, w: panelWidth };
      let moved = false;
      setDragging(true);
      const onMove = (ev: PointerEvent): void => {
        const d = dragRef.current;
        if (!d) return;
        if (Math.abs(ev.clientX - d.x) > 3) moved = true;
        // Ручка на ЛЕВОМ крае правой панели: влево (меньше clientX) = шире.
        setPanelWidth(clampPanelWidth(d.w - (ev.clientX - d.x)));
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
        // Клик без тяги — закрыть панель; иначе — запомнить ширину.
        if (!moved) {
          onOpenChange(false);
          return;
        }
        setPanelWidth((w) => {
          try {
            localStorage.setItem(PANEL_WIDTH_KEY, String(w));
          } catch {
            /* ignore */
          }
          return w;
        });
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [panelWidth, onOpenChange],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        showClose={false}
        // Немодально: остальной сайт кликабелен; клик мимо панели её не закрывает.
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        style={isDesktop ? { width: panelWidth, maxWidth: '95vw' } : undefined}
        className={cn(
          'group/ai-panel flex h-full w-full flex-col gap-0 overflow-hidden p-0',
          dragging && 'select-none',
        )}
      >
        <SheetTitle className="sr-only">Чат с ИИ</SheetTitle>
        {/* Ручка ресайза у левого края — только на десктопе (на мобиле панель во всю ширину). */}
        {isDesktop && (
          <ResizeHandleHint side="left" action="Закрыть" shortcut="Клик">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Изменить ширину панели или закрыть"
              onPointerDown={onHandlePointerDown}
              className={cn(
                'absolute inset-y-0 left-0 z-50 w-1.5 -translate-x-1/2 cursor-col-resize touch-none',
                'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:transition-colors hover:before:bg-primary/40',
                dragging && 'before:bg-primary/60',
              )}
            />
          </ResizeHandleHint>
        )}

        <div className="flex h-11 shrink-0 items-center px-2.5">
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Свернуть"
              title="Свернуть"
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground md:opacity-0 md:focus-visible:opacity-100 md:group-hover/ai-panel:opacity-100"
            >
              <ChevronsRight className="size-5" />
            </button>
          </SheetClose>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {conversationId && (
            <AiConversationView key={conversationId} conversationId={conversationId} compact />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
