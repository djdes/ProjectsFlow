import { useState } from 'react';
import { Braces, Copy, Eye, LayoutGrid, Link2, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SiteEditorPatch } from '@/application/site-editor/SiteEditorRepository';
import type { InspectedElement } from './types';
import { StyleThemePopover } from './StyleThemePopover';

export function PreviewElementToolbar({ element, styleOpen, onStyleOpen, onPatch, onAi, onCode, onDelete, onClose }: {
  element: InspectedElement; styleOpen: boolean; onStyleOpen: (open: boolean) => void; onPatch: (patch: SiteEditorPatch) => void;
  onAi: () => void; onCode: () => void; onDelete: () => void; onClose: () => void;
}): React.ReactElement {
  const [href, setHref] = useState(element.locator.attributes?.href ?? '');
  return (
    <div className="pointer-events-auto absolute z-40 flex max-w-[calc(100%-16px)] items-center gap-0.5 overflow-x-auto rounded-xl border bg-background p-1 shadow-xl" style={{ left: Math.max(8, element.bounds.x), top: Math.max(8, element.bounds.y + element.bounds.height + 8) }} role="toolbar" aria-label={`Редактирование: ${element.label}`}>
      <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5" onClick={onAi}><Sparkles className="size-4" />Изменить с ИИ</Button>
      <StyleThemePopover open={styleOpen} onOpenChange={onStyleOpen} element={element} onPatch={onPatch} />
      <Popover>
        <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Изменить ссылку"><Link2 className="size-4" /></Button></PopoverTrigger>
        <PopoverContent className="w-[min(90vw,320px)] p-3"><label className="text-xs font-medium">Ссылка</label><div className="mt-1.5 flex gap-1.5"><input value={href} onChange={(event) => setHref(event.target.value)} placeholder="/catalog или https://…" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" /><Button size="sm" className="h-9" onClick={() => onPatch({ kind: 'attribute', name: 'href', value: href })}>OK</Button></div></PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Изменить компоновку" onClick={() => onPatch({ kind: 'command', command: 'layout' })}><LayoutGrid className="size-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Скрыть или показать" onClick={() => onPatch({ kind: 'command', command: 'toggle-visibility' })}><Eye className="size-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Дублировать элемент" onClick={() => onPatch({ kind: 'command', command: 'duplicate' })}><Copy className="size-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Показать код" onClick={onCode}><Braces className="size-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 text-destructive hover:text-destructive" aria-label="Удалить элемент" onClick={onDelete}><Trash2 className="size-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Закрыть редактирование элемента" onClick={onClose}><X className="size-4" /></Button>
    </div>
  );
}
