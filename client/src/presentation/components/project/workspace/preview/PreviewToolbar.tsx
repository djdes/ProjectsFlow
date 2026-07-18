import { useEffect, useId, useRef } from 'react';
import { Check, ChevronDown, Code2, ExternalLink, Grid2X2, Loader2, Monitor, MousePointer2, RefreshCw, Redo2, Smartphone, Tablet, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PreviewDevice, PreviewMode, SaveStatus } from './types';

const DEVICES: Array<{ value: PreviewDevice; label: string; icon: typeof Monitor }> = [
  { value: 'desktop', label: 'Компьютер', icon: Monitor },
  { value: 'tablet', label: 'Планшет', icon: Tablet },
  { value: 'mobile', label: 'Телефон', icon: Smartphone },
];

export function PreviewToolbar({
  mode, device, path, draftPath, routes, routeMenuOpen, saveStatus, undoDepth, redoDepth, draftCount, queuedCount,
  leading, trailing, studioLayout = false,
  onMode, onDevice, onDraftPath, onApplyPath, onRouteMenu, onReload, onOpen, onUndo, onRedo, onCode, onPublish, onReject,
}: {
  mode: PreviewMode; device: PreviewDevice; path: string; draftPath: string; routes: string[]; routeMenuOpen: boolean;
  saveStatus: SaveStatus; undoDepth: number; redoDepth: number;
  draftCount: number; queuedCount: number;
  leading?: React.ReactNode; trailing?: React.ReactNode; studioLayout?: boolean;
  onMode: (mode: PreviewMode) => void; onDevice: (device: PreviewDevice) => void; onDraftPath: (path: string) => void;
  onApplyPath: (path: string) => void; onRouteMenu: (open: boolean) => void; onReload: () => void; onOpen: () => void;
  onUndo: () => void; onRedo: () => void; onCode: () => void; onPublish: () => void; onReject: () => void;
}): React.ReactElement {
  const listId = useId();
  const routeBoxRef = useRef<HTMLDivElement>(null);
  const filteredRoutes = routes.filter((route) => route.toLocaleLowerCase().includes(draftPath.toLocaleLowerCase()) || draftPath === path);
  useEffect(() => {
    if (!routeMenuOpen) return;
    const close = (event: MouseEvent): void => { if (!routeBoxRef.current?.contains(event.target as Node)) onRouteMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onRouteMenu, routeMenuOpen]);

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 border-b bg-background px-2 py-1.5',
        studioLayout ? 'min-h-[52px] flex-nowrap overflow-x-auto' : 'min-h-12 flex-wrap',
      )}
      aria-label="Панель Preview"
    >
      {leading}
      <div className="flex items-center rounded-lg border bg-muted/30 p-0.5" role="tablist" aria-label="Режим Preview">
        {((studioLayout
          ? [['edit', 'Edit', MousePointer2], ['canvas', 'Canvas', Grid2X2]]
          : [['preview', 'Preview', Monitor], ['edit', 'Edit', MousePointer2], ['canvas', 'Canvas', Grid2X2]]) as ReadonlyArray<readonly [PreviewMode, string, typeof Monitor]>).map(([value, label, Icon]) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => onMode(studioLayout && mode === value ? 'preview' : value)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors motion-reduce:transition-none hover:text-foreground', mode === value && 'bg-background text-foreground shadow-sm')}>
            <Icon className="size-3.5" />{label}
          </button>
        ))}
      </div>

      <div className="relative min-w-[210px] flex-1" ref={routeBoxRef}>
        <form className="flex items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/30" onSubmit={(event) => { event.preventDefault(); onApplyPath(draftPath); }}>
          <input value={draftPath} onChange={(event) => { onDraftPath(event.target.value); onRouteMenu(true); }} onFocus={() => onRouteMenu(true)} onKeyDown={(event) => { if (event.key === 'Escape') onRouteMenu(false); }} role="combobox" aria-label="Путь страницы результата" aria-expanded={routeMenuOpen} aria-controls={listId} aria-autocomplete="list" className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder="/catalog" />
          <button type="button" className="grid size-9 place-items-center text-muted-foreground hover:text-foreground" aria-label="Показать страницы" aria-expanded={routeMenuOpen} onClick={() => onRouteMenu(!routeMenuOpen)}><ChevronDown className="size-4" /></button>
        </form>
        {routeMenuOpen && (
          <div id={listId} role="listbox" aria-label="Страницы результата" className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
            {filteredRoutes.map((route) => (
              <button key={route} type="button" role="option" aria-selected={route === path} className={cn('flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted', route === path && 'bg-muted font-medium')} onClick={() => onApplyPath(route)}>{route}</button>
            ))}
            {!filteredRoutes.length && <p className="px-2.5 py-2 text-sm text-muted-foreground">Ничего не найдено. Можно ввести путь вручную и нажать Enter.</p>}
          </div>
        )}
      </div>

      {mode === 'edit' && (
        <>
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            <Button type="button" variant="ghost" size="icon" className="size-8" disabled={!undoDepth || saveStatus === 'saving' || queuedCount > 0} onClick={onUndo} aria-label="Отменить изменение"><Undo2 className="size-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="size-8" disabled={!redoDepth || saveStatus === 'saving' || queuedCount > 0} onClick={onRedo} aria-label="Повторить изменение"><Redo2 className="size-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onCode} aria-label="Показать код выбранного элемента"><Code2 className="size-4" /></Button>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" disabled={!draftCount || saveStatus === 'saving' || queuedCount > 0} onClick={onReject}><X className="size-3.5" />Отклонить</Button>
          <Button type="button" size="sm" className="h-9 gap-1.5" disabled={!draftCount || saveStatus === 'saving' || queuedCount > 0} onClick={onPublish}>{queuedCount > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{queuedCount > 0 ? 'Публикуем…' : `Применить${draftCount ? ` (${draftCount})` : ''}`}</Button>
        </>
      )}

      <div className="flex items-center rounded-lg border bg-background p-0.5" aria-label="Размер Preview">
        {DEVICES.map(({ value, label, icon: Icon }) => <button key={value} type="button" title={label} aria-label={label} aria-pressed={device === value} onClick={() => onDevice(value)} className={cn('grid size-8 place-items-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none hover:text-foreground', device === value && 'bg-muted text-foreground')}><Icon className="size-4" /></button>)}
      </div>
      <Button type="button" variant="outline" size="icon" className="size-9" aria-label="Обновить Preview" onClick={onReload}><RefreshCw className="size-4" /></Button>
      <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={onOpen}><ExternalLink className="size-3.5" />Открыть</Button>
      {trailing}
      <span className="sr-only" role="status" aria-live="polite">{saveStatus === 'saving' ? 'Сохраняем изменение' : saveStatus === 'error' ? 'Не удалось сохранить изменение' : saveStatus === 'dirty' ? 'Есть несохранённые изменения' : 'Изменения сохранены'}</span>
    </div>
  );
}
