import { forwardRef } from 'react';
import { AlertTriangle, Loader2, Monitor, PlugZap } from 'lucide-react';
import type { SiteEditorPatch } from '@/application/site-editor/SiteEditorRepository';
import { cn } from '@/lib/utils';
import type { BridgeStatus, InspectedElement, PreviewDevice, PreviewMode } from './types';
import { PreviewElementToolbar } from './PreviewElementToolbar';

const DEVICE_FRAME: Record<PreviewDevice, { width: string; height: number; label: string }> = {
  desktop: { width: '100%', height: 760, label: 'Компьютер' },
  tablet: { width: '768px', height: 1024, label: 'Планшет' },
  mobile: { width: '390px', height: 844, label: 'Телефон' },
};

export const PreviewCanvas = forwardRef<HTMLIFrameElement, {
  frameKey: number; previewUrl: string; path: string; mode: PreviewMode; device: PreviewDevice; loading: boolean; slow: boolean;
  bridgeStatus: BridgeStatus; bridgeError: string | null; hovered: InspectedElement | null; selected: InspectedElement | null;
  styleOpen: boolean; onLoad: () => void; onStyleOpen: (open: boolean) => void; onPatch: (patch: SiteEditorPatch) => void;
  onAi: () => void; onCode: () => void; onDelete: () => void; onCloseSelection: () => void;
}>(function PreviewCanvas({ frameKey, previewUrl, path, mode, device, loading, slow, bridgeStatus, bridgeError, hovered, selected, styleOpen, onLoad, onStyleOpen, onPatch, onAi, onCode, onDelete, onCloseSelection }, ref) {
  const frame = DEVICE_FRAME[device];
  const highlight = selected ?? hovered;
  return (
    <div className="relative min-h-[620px] overflow-auto bg-[#f3f3f2] p-3 dark:bg-[#111] sm:p-5">
      <div className="relative mx-auto min-h-[580px] overflow-hidden border bg-white transition-[width] duration-300 ease-out motion-reduce:transition-none dark:bg-zinc-950" style={{ width: frame.width, maxWidth: '100%' }}>
        {loading && <div className="absolute inset-0 z-50 grid place-items-center bg-background"><div className="text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{slow ? 'Сайт загружается дольше обычного…' : 'Загружаем результат…'}</div></div>}
        <iframe ref={ref} key={frameKey} src={previewUrl} title={`Результат проекта — ${path}`} className="w-full border-0 bg-white" style={{ height: frame.height }} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin" referrerPolicy="strict-origin-when-cross-origin" onLoad={onLoad} />
        {mode === 'edit' && (
          <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
            {highlight && <><div className={cn('absolute border-2', selected ? 'border-blue-600 bg-blue-500/5' : 'border-blue-400 bg-blue-400/5')} style={{ left: highlight.bounds.x, top: highlight.bounds.y, width: highlight.bounds.width, height: highlight.bounds.height }} /><span className="absolute -translate-y-full rounded-t bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ left: Math.max(0, highlight.bounds.x), top: Math.max(18, highlight.bounds.y) }}>{highlight.locator.tagName.toLowerCase()} · {highlight.label}</span></>}
            {selected && <PreviewElementToolbar element={selected} styleOpen={styleOpen} onStyleOpen={onStyleOpen} onPatch={onPatch} onAi={onAi} onCode={onCode} onDelete={onDelete} onClose={onCloseSelection} />}
          </div>
        )}
      </div>
      <span className="pointer-events-none absolute bottom-5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur"><Monitor className="size-3" />{frame.label}</span>
      {mode === 'edit' && bridgeStatus !== 'ready' && <div className={cn('absolute right-7 top-7 z-40 flex max-w-xs items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur', bridgeStatus === 'error' && 'border-destructive/30 text-destructive')} role="status" aria-live="polite">{bridgeStatus === 'error' ? <AlertTriangle className="size-4 shrink-0" /> : <PlugZap className="size-4 shrink-0" />}<span>{bridgeStatus === 'connecting' ? 'Подключаем инспектор…' : bridgeError || 'Инспектор ожидает подключение preview bridge.'}</span></div>}
    </div>
  );
});
