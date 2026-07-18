import { useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Note = { id: string; x: number; y: number; text: string };

export function CanvasRouteMap({ routes, baseUrl, onOpenRoute, fillAvailable = false }: { routes: string[]; baseUrl: string; onOpenRoute: (path: string) => void; fillAvailable?: boolean }): React.ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.72);
  const [offset, setOffset] = useState({ x: 64, y: 52 });
  const [notes, setNotes] = useState<Note[]>([]);
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frames = useMemo(() => routes.map((path, index) => ({ path, x: (index % 3) * 430, y: Math.floor(index / 3) * 390 })), [routes]);
  const fit = (): void => { setScale(Math.min(0.85, Math.max(0.35, (surfaceRef.current?.clientWidth ?? 900) / Math.max(900, Math.min(3, frames.length) * 430 + 80)))); setOffset({ x: 48, y: 48 }); };
  return (
    <div ref={surfaceRef} className={`relative overflow-hidden bg-[radial-gradient(circle,#d7d7d7_1px,transparent_1px)] [background-size:20px_20px] dark:bg-[radial-gradient(circle,#333_1px,transparent_1px)] ${fillAvailable ? 'min-h-0 flex-1' : 'min-h-[680px]'}`} onPointerDown={(event) => { if (event.target === event.currentTarget) { event.currentTarget.setPointerCapture(event.pointerId); setDrag({ x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }); } }} onPointerMove={(event) => { if (drag) setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y }); }} onPointerUp={() => setDrag(null)} onWheel={(event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setScale((value) => Math.min(1.4, Math.max(0.25, value - event.deltaY * 0.001))); } }} aria-label="Карта страниц проекта">
      <div className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-sm">
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Уменьшить" onClick={() => setScale((value) => Math.max(0.25, value - 0.1))}><Minus className="size-4" /></Button><span className="w-12 text-center text-xs">{Math.round(scale * 100)}%</span><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Увеличить" onClick={() => setScale((value) => Math.min(1.4, value + 0.1))}><Plus className="size-4" /></Button><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Вписать страницы" onClick={fit}><Maximize2 className="size-4" /></Button><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Добавить заметку" onClick={() => setNotes((current) => [...current, { id: crypto.randomUUID(), x: 40 - offset.x, y: 110 - offset.y, text: 'Новая заметка' }])}><StickyNote className="size-4" /></Button>
      </div>
      <div className="absolute left-0 top-0 origin-top-left motion-reduce:transition-none" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
        {frames.map((frame) => <article key={frame.path} className="absolute w-[390px] overflow-hidden rounded-xl border bg-background shadow-lg" style={{ left: frame.x, top: frame.y }}><button type="button" className="flex h-10 w-full items-center justify-between border-b px-3 text-left text-sm font-medium hover:bg-muted" onClick={() => onOpenRoute(frame.path)}><span>{frame.path}</span><span className="text-xs text-muted-foreground">Открыть</span></button><iframe src={new URL(frame.path, `${new URL(baseUrl).origin}/`).toString()} title={`Страница ${frame.path}`} className="pointer-events-none h-[300px] w-[780px] origin-top-left scale-50 border-0" sandbox="allow-scripts allow-forms allow-same-origin" /></article>)}
        {notes.map((note) => <textarea key={note.id} value={note.text} onChange={(event) => setNotes((current) => current.map((item) => item.id === note.id ? { ...item, text: event.target.value } : item))} className="absolute h-32 w-48 resize-none rounded-sm bg-amber-200 p-3 text-sm text-amber-950 shadow" style={{ left: note.x, top: note.y }} aria-label="Заметка на карте" />)}
      </div>
    </div>
  );
}
