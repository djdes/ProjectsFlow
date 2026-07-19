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
  styleOpen: boolean; fillAvailable?: boolean; onLoad: () => void; onStyleOpen: (open: boolean) => void; onPatch: (patch: SiteEditorPatch) => void;
  onAi: () => void; onCode: () => void; onDelete: () => void; onCloseSelection: () => void;
}>(function PreviewCanvas({ frameKey, previewUrl, path, mode, device, loading, slow, bridgeStatus, bridgeError, hovered, selected, styleOpen, fillAvailable = false, onLoad, onStyleOpen, onPatch, onAi, onCode, onDelete, onCloseSelection }, ref) {
  const frame = DEVICE_FRAME[device];
  const highlight = selected ?? hovered;
  return (
    <div className={cn('relative overflow-auto bg-[#f3f3f2] dark:bg-[#111]', fillAvailable ? 'min-h-0 flex-1 p-0' : 'min-h-[620px] p-3 sm:p-5')}>
      <div className={cn('relative mx-auto overflow-hidden border bg-white transition-[width] duration-300 ease-out motion-reduce:transition-none dark:bg-zinc-950', fillAvailable && device === 'desktop' ? 'h-full min-h-0 border-0' : 'min-h-[580px]')} style={{ width: frame.width, maxWidth: '100%' }}>
        {loading && <div className="absolute inset-0 z-50 grid place-items-center bg-background"><div className="text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{slow ? 'Сайт загружается дольше обычного…' : 'Загружаем результат…'}</div></div>}
        {/*
          sandbox содержит allow-scripts + allow-same-origin одновременно. Обычно эта пара
          снимает песочницу, но здесь она безопасна и нужна — мосту (bridgeProtocol) требуется
          доступ к DOM собственного документа. Держится на трёх условиях, не ломайте их:
            1. previewUrl ВСЕГДА указывает на отдельный поддомен <slug>.projectsflow.ru
               (siteResultUrl), никогда на origin приложения. allow-same-origin даёт iframe
               его собственный origin — до родителя он всё равно не дотянется.
            2. Сессионная кука httpOnly и host-only (без domain=) — на поддомен не уходит
               и недоступна из JS превью. См. server auth/routes.ts → sessionCookieOptions.
            3. Мутации из поддоменов режет csrfOriginGuard по Sec-Fetch-Site.
          Если превью когда-нибудь начнут отдавать с основного origin — этот sandbox надо
          переделывать, иначе страница получит полный доступ к приложению.
        */}
        <iframe ref={ref} key={frameKey} src={previewUrl} title={`Результат проекта — ${path}`} className="w-full border-0 bg-white" style={{ height: fillAvailable && device === 'desktop' ? '100%' : frame.height }} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin" referrerPolicy="strict-origin-when-cross-origin" onLoad={onLoad} />
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
