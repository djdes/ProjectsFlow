import { useEffect, useState } from 'react';
import { Palette, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SiteEditorPatch } from '@/application/site-editor/SiteEditorRepository';
import type { InspectedElement } from './types';

const FIELD_GROUPS = [
  { title: 'Цвета', fields: [['color', 'Текст'], ['backgroundColor', 'Фон'], ['borderColor', 'Рамка']] },
  { title: 'Форма', fields: [['borderRadius', 'Скругление'], ['borderWidth', 'Толщина рамки'], ['padding', 'Внутренний отступ'], ['margin', 'Внешний отступ'], ['gap', 'Промежуток']] },
  { title: 'Типографика', fields: [['fontSize', 'Размер'], ['fontWeight', 'Насыщенность'], ['lineHeight', 'Высота строки'], ['letterSpacing', 'Трекинг']] },
] as const;

const THEME_PRESETS = [
  { name: 'Светлая', backgroundColor: '#ffffff', color: '#171717', borderColor: '#e5e7eb' },
  { name: 'Графит', backgroundColor: '#171717', color: '#fafafa', borderColor: '#3f3f46' },
  { name: 'Океан', backgroundColor: '#ecfeff', color: '#164e63', borderColor: '#67e8f9' },
  { name: 'Тёплая', backgroundColor: '#fff7ed', color: '#7c2d12', borderColor: '#fdba74' },
] as const;

export function StyleThemePopover({ open, onOpenChange, element, onPatch }: { open: boolean; onOpenChange: (open: boolean) => void; element: InspectedElement; onPatch: (patch: SiteEditorPatch) => void }): React.ReactElement {
  const [text, setText] = useState(element.locator.text ?? '');
  const [values, setValues] = useState<Record<string, string>>(element.styles ?? {});
  const [tab, setTab] = useState<'theme' | 'custom'>('theme');
  useEffect(() => { setText(element.locator.text ?? ''); setValues(element.styles ?? {}); }, [element]);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Стиль и содержимое"><Palette className="size-4" /></Button></PopoverTrigger>
      <PopoverContent align="center" className="max-h-[min(70vh,620px)] w-[min(92vw,360px)] overflow-auto p-3">
        <div className="mb-3 flex items-center gap-2"><Type className="size-4" /><h3 className="text-sm font-semibold">Стиль элемента</h3></div>
        <div className="mb-3 grid grid-cols-2 rounded-lg bg-muted/60 p-0.5" role="tablist" aria-label="Настройки цвета"><button type="button" role="tab" aria-selected={tab === 'theme'} onClick={() => setTab('theme')} className={`h-8 rounded-md text-sm ${tab === 'theme' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>Theme</button><button type="button" role="tab" aria-selected={tab === 'custom'} onClick={() => setTab('custom')} className={`h-8 rounded-md text-sm ${tab === 'custom' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>Custom</button></div>
        {tab === 'theme' && <div className="mb-4 grid grid-cols-2 gap-2">{THEME_PRESETS.map((preset) => <button key={preset.name} type="button" className="rounded-lg border p-2 text-left text-xs transition-colors hover:bg-muted/40" onClick={() => { onPatch({ kind: 'style', property: 'backgroundColor', value: preset.backgroundColor }); onPatch({ kind: 'style', property: 'color', value: preset.color }); onPatch({ kind: 'style', property: 'borderColor', value: preset.borderColor }); }}><span className="mb-2 flex overflow-hidden rounded-md border"><span className="h-5 flex-1" style={{ backgroundColor: preset.backgroundColor }} /><span className="h-5 flex-1" style={{ backgroundColor: preset.color }} /><span className="h-5 flex-1" style={{ backgroundColor: preset.borderColor }} /></span><span className="font-medium">{preset.name}</span></button>)}</div>}
        <label className="block text-xs font-medium text-muted-foreground">Текст</label>
        <div className="mt-1 flex gap-1.5"><input value={text} onChange={(event) => setText(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" maxLength={4_000} /><Button size="sm" className="h-9" onClick={() => onPatch({ kind: 'text', value: text })}>Применить</Button></div>
        {tab === 'custom' && FIELD_GROUPS.map((group) => <fieldset key={group.title} className="mt-4 space-y-2"><legend className="mb-1 text-xs font-semibold text-muted-foreground">{group.title}</legend>{group.fields.map(([property, label]) => { const color = property.includes('Color') || property === 'color'; return <label key={property} className="grid grid-cols-[118px_1fr] items-center gap-2 text-xs"><span>{label}</span><span className="flex min-w-0 gap-1">{color && <input type="color" value={/^#[0-9a-f]{6}$/i.test(values[property] ?? '') ? values[property] : '#000000'} onChange={(event) => { setValues((current) => ({ ...current, [property]: event.target.value })); onPatch({ kind: 'style', property, value: event.target.value }); }} className="h-8 w-9 rounded border bg-background p-0.5" aria-label={`${label}: выбрать цвет`} />}<input value={values[property] ?? ''} placeholder={color ? '#000000' : '16px'} onChange={(event) => setValues((current) => ({ ...current, [property]: event.target.value }))} onBlur={() => { if (values[property]) onPatch({ kind: 'style', property, value: values[property] }); }} onKeyDown={(event) => { if (event.key === 'Enter' && values[property]) onPatch({ kind: 'style', property, value: values[property] }); }} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" /></span></label>; })}</fieldset>)}
      </PopoverContent>
    </Popover>
  );
}
