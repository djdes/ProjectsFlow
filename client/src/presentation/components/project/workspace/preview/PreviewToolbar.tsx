import { useEffect, useId, useRef } from 'react';
import { Grid2X2, Monitor, MoreHorizontal, MousePointer2, RefreshCw, Redo2, Rocket, Smartphone, Tablet, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
// Тёмный тултип берём из шапки студии: тулбар стоит в той же строке, что и StudioTopBar,
// и разъезжаться по стилям им нельзя. Своей копии константы здесь быть не должно.
import { DARK_TOOLTIP } from '@/presentation/components/project/studio/StudioTopBar';
import type { PreviewDevice, PreviewMode, SaveStatus } from './types';

const DEVICES: Array<{ value: PreviewDevice; label: string; icon: typeof Monitor }> = [
  { value: 'desktop', label: 'Компьютер', icon: Monitor },
  { value: 'tablet', label: 'Планшет', icon: Tablet },
  { value: 'mobile', label: 'Телефон', icon: Smartphone },
];

// Подсказки к вкладкам — тот же приём, что в StudioTopBar: label английский и сам по себе
// не объясняет, что за ним стоит.
const MODE_HINTS: Record<PreviewMode, string> = {
  preview: 'Превью результата',
  edit: 'Правка элементов на странице',
  canvas: 'Карта страниц проекта',
};

export function PreviewToolbar({
  mode, device, path, draftPath, routes, routeMenuOpen, saveStatus, undoDepth, redoDepth, draftCount, queuedCount,
  leading, trailing, studioLayout = false,
  onMode, onDevice, onDraftPath, onApplyPath, onRouteMenu, onReload, onUndo, onRedo, onExitEdit, onPublish, onReject,
}: {
  mode: PreviewMode; device: PreviewDevice; path: string; draftPath: string; routes: string[]; routeMenuOpen: boolean;
  saveStatus: SaveStatus; undoDepth: number; redoDepth: number;
  draftCount: number; queuedCount: number;
  leading?: React.ReactNode; trailing?: React.ReactNode; studioLayout?: boolean;
  onMode: (mode: PreviewMode) => void; onDevice: (device: PreviewDevice) => void; onDraftPath: (path: string) => void;
  onApplyPath: (path: string) => void; onRouteMenu: (open: boolean) => void; onReload: () => void;
  onUndo: () => void; onRedo: () => void; onCode: () => void;
  // Повторный клик по Edit: выйти из режима и сохранить накопленные правки в проект.
  onExitEdit: () => void;
  onPublish: () => void; onReject: () => void;
}): React.ReactElement {
  const listId = useId();
  const routeBoxRef = useRef<HTMLDivElement>(null);
  const activeDeviceIndex = Math.max(0, DEVICES.findIndex((item) => item.value === device));
  const activeDevice = DEVICES[activeDeviceIndex] ?? DEVICES[0]!;
  const nextDevice = DEVICES[(activeDeviceIndex + 1) % DEVICES.length]!;
  // Один текст на aria-label и тултип: расходиться им нельзя, а нативный title у кнопки
  // убран — иначе поверх Radix-тултипа всплывала бы вторая подсказка браузера.
  const deviceHint = `Устройство: ${activeDevice.label}. Переключить на ${nextDevice.label}`;
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
        'flex items-center gap-1 border-b bg-background px-2 py-1',
        // В studio-раскладке высота ЖЁСТКАЯ (h-11) и совпадает с хедером левой панели —
        // только так нижние границы обеих панелей сходятся в одну сплошную линию.
        // min-h-* здесь нельзя: тулбар подрастает от контента и линия разъезжается.
        studioLayout ? 'h-11 shrink-0 flex-nowrap overflow-x-auto' : 'min-h-11 flex-wrap',
      )}
      aria-label="Панель Preview"
    >
      {leading}
      <div className="flex items-center rounded-md border bg-background p-0.5" role="tablist" aria-label="Режим Preview">
        {((studioLayout
          ? [['edit', 'Edit', MousePointer2], ['canvas', 'Canvas', Grid2X2]]
          : [['preview', 'Preview', Monitor], ['edit', 'Edit', MousePointer2], ['canvas', 'Canvas', Grid2X2]]) as ReadonlyArray<readonly [PreviewMode, string, typeof Monitor]>).map(([value, label, Icon]) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <button type="button" role="tab" aria-label={label} aria-selected={mode === value} onClick={() => {
                // Повторный клик по активной вкладке возвращает в Preview. Для Edit это
                // отдельный сигнал: именно он сохраняет правки в проект (см. onExitEdit).
                // Уход на Canvas или иной путь наружу ничего не публикует.
                if (studioLayout && mode === value) {
                  if (value === 'edit') onExitEdit();
                  else onMode('preview');
                  return;
                }
                onMode(value);
              }} className={cn('inline-flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-sm text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-muted/60 hover:text-foreground', value === 'canvas' ? 'w-7 px-0' : 'px-2.5', mode === value && 'bg-muted text-foreground')}>
                <Icon className="size-3.5" />{value === 'canvas' ? <span className="sr-only">{label}</span> : label}
              </button>
            </TooltipTrigger>
            {/* На активной Edit тултип объясняет неочевидное: повторный клик выходит из
                режима и сохраняет накопленные правки в проект. */}
            <TooltipContent side="bottom" className={DARK_TOOLTIP}>
              {studioLayout && value === 'edit' && mode === 'edit' ? 'Выйти из правки и сохранить изменения в проект' : MODE_HINTS[value]}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className={cn(studioLayout ? 'relative mx-auto w-[min(200px,22vw)] min-w-[132px] shrink-0' : 'relative min-w-[180px] flex-1')} ref={routeBoxRef}>
        <form className="flex h-8 items-center rounded-md border bg-background px-0.5 focus-within:border-foreground/25 focus-within:ring-1 focus-within:ring-ring/20" onSubmit={(event) => { event.preventDefault(); onApplyPath(draftPath); }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Обновить Preview" onClick={onReload}><RefreshCw className="size-3.5" /></button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className={DARK_TOOLTIP}>Обновить Preview</TooltipContent>
          </Tooltip>
          {/* У самого поля пути тултипа нет: по фокусу под ним раскрывается список страниц,
              и всплывающая подсказка перекрывала бы его первые пункты. Роль поля объясняют
              placeholder и aria-label. */}
          <input value={draftPath} onChange={(event) => { onDraftPath(event.target.value); onRouteMenu(true); }} onFocus={() => onRouteMenu(true)} onKeyDown={(event) => { if (event.key === 'Escape') onRouteMenu(false); }} role="combobox" aria-label="Путь страницы результата" aria-expanded={routeMenuOpen} aria-controls={listId} aria-autocomplete="list" className="h-7 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none" placeholder="/catalog" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={deviceHint} onMouseDown={(event) => event.preventDefault()} onClick={() => onDevice(nextDevice.value)}><activeDevice.icon className="size-3.5" /></button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className={DARK_TOOLTIP}>{deviceHint}</TooltipContent>
          </Tooltip>
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
          <div className="flex items-center">
            {/* Тултип у disabled-кнопки не всплывает (браузер не шлёт события с disabled) —
                это нормально: подсказка нужна ровно тогда, когда действие доступно. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-7 rounded" disabled={!undoDepth || saveStatus === 'saving' || queuedCount > 0} onClick={onUndo} aria-label="Отменить изменение"><Undo2 className="size-3.5" /></Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={DARK_TOOLTIP}>Отменить изменение</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-7 rounded" disabled={!redoDepth || saveStatus === 'saving' || queuedCount > 0} onClick={onRedo} aria-label="Повторить изменение"><Redo2 className="size-3.5" /></Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={DARK_TOOLTIP}>Повторить изменение</TooltipContent>
            </Tooltip>
          </div>
          {/* Сами правки сохраняются мгновенно — кнопки «Сохранить» тут не нужно.
              А вот публикация переписывает исходный код проекта и передеплоивает его,
              поэтому остаётся ЯВНЫМ действием и живёт в «…». */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 rounded" disabled={saveStatus === 'saving' || queuedCount > 0} aria-label="Действия с правками"><MoreHorizontal className="size-3.5" /></Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={DARK_TOOLTIP}>Действия с правками</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem disabled={!draftCount} onSelect={onPublish}>
                <Rocket className="size-4" />Опубликовать правки{draftCount ? ` (${draftCount})` : ''}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={!draftCount} onSelect={onReject}>
                <Trash2 className="size-4" />Отклонить все правки
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {trailing}
      <span className="sr-only" role="status" aria-live="polite">{saveStatus === 'saving' ? 'Сохраняем изменение' : saveStatus === 'error' ? 'Не удалось сохранить изменение' : saveStatus === 'dirty' ? 'Есть несохранённые изменения' : 'Изменения сохранены'}</span>
    </div>
  );
}
