import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Check, Copy, Eye, Loader2, Save, Sparkles, WrapText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SiteEditorPatch } from '@/application/site-editor/SiteEditorRepository';
import type { InspectedElement, PreviewEditorState } from './types';

type CodeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  element: InspectedElement | null;
  status: PreviewEditorState['aiStatus'];
  message: string | null;
  onPatch: (patch: SiteEditorPatch) => void;
  onEditWithAi: (prompt: string) => void;
};

const WIDTH_KEY = 'pf-site-code-panel-width';

function initialWidth(): number {
  const stored = Number(window.localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(stored) ? Math.min(900, Math.max(360, stored)) : 580;
}

export function CodeSheet({ open, onOpenChange, element, status, message, onPatch, onEditWithAi }: CodeSheetProps): React.ReactElement | null {
  const [tab, setTab] = useState<'preview' | 'source'>('source');
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [sourceDraft, setSourceDraft] = useState('');
  const [width, setWidth] = useState(initialWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const source = element?.source || '';
  const busy = status === 'submitting' || status === 'queued' || status === 'running';
  const styleEntries = useMemo(() => Object.entries(element?.styles ?? {}), [element?.styles]);
  const attributeEntries = useMemo(() => Object.entries(element?.locator.attributes ?? {}), [element?.locator.attributes]);

  useEffect(() => {
    setCopied(false);
    setPrompt('');
    setSourceDraft(source);
  }, [element?.locator.selector, source]);

  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.min(Math.max(360, window.innerWidth * 0.85), Math.max(360, drag.startWidth + drag.startX - event.clientX));
      setWidth(next);
    };
    const stop = (): void => { dragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); stop(); };
  }, []);

  const copy = async (): Promise<void> => {
    if (!sourceDraft) return;
    await navigator.clipboard?.writeText(sourceDraft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  if (!open) return null;

  return (
    <aside
      style={{ width }}
      className="absolute inset-y-0 right-0 z-40 flex max-w-[85vw] flex-col border-l bg-background shadow-2xl"
      aria-label="Элемент и код"
    >
      <button
        type="button"
        className="absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 hover:before:bg-primary focus-visible:before:bg-primary"
        aria-label="Изменить ширину панели кода"
        onPointerDown={(event) => {
          dragRef.current = { startX: event.clientX, startWidth: width };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />

      <header className="flex items-start gap-3 border-b px-5 py-4 text-left">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Элемент и код</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{element ? `${element.locator.tagName.toLowerCase()} · ${element.locator.selector}` : 'Выберите элемент в Preview — панель останется открытой.'}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => onOpenChange(false)} aria-label="Закрыть панель"><X className="size-4" /></Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Представление элемента">
          <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground', tab === 'preview' && 'bg-background text-foreground shadow-sm')}><Eye className="size-3.5" />Параметры</button>
          <button type="button" role="tab" aria-selected={tab === 'source'} onClick={() => setTab('source')} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground', tab === 'source' && 'bg-background text-foreground shadow-sm')}><Braces className="size-3.5" />Исходник</button>
        </div>
        <div className="flex items-center gap-1.5">
          {tab === 'source' && <Button type="button" variant="outline" size="icon" className="size-8" aria-label={wrap ? 'Не переносить длинные строки' : 'Переносить длинные строки'} aria-pressed={wrap} onClick={() => setWrap((value) => !value)}><WrapText className="size-3.5" /></Button>}
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" disabled={!sourceDraft} onClick={() => void copy()}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Готово' : 'Копировать'}</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'source' ? (
          <div className="flex min-h-full flex-col bg-zinc-950">
            <textarea
              value={sourceDraft}
              onChange={(event) => setSourceDraft(event.target.value)}
              disabled={!element}
              spellCheck={false}
              className={cn('min-h-[360px] flex-1 resize-none bg-transparent p-5 font-mono text-xs leading-5 text-zinc-100 outline-none', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}
              aria-label="Исходный HTML выбранного элемента"
            />
            <div className="sticky bottom-0 flex justify-end border-t border-white/10 bg-zinc-950/95 p-3 backdrop-blur">
              <Button type="button" size="sm" className="gap-1.5" disabled={!element || !sourceDraft.trim() || sourceDraft === source} onClick={() => onPatch({ kind: 'html', value: sourceDraft })}><Save className="size-3.5" />Сохранить исходник</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <section className="space-y-2 rounded-xl border bg-muted/15 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Содержимое</p>
              <Input key={`${element?.locator.selector}:text`} defaultValue={element?.locator.text ?? ''} disabled={!element} onBlur={(event) => { if (event.target.value !== (element?.locator.text ?? '')) onPatch({ kind: 'text', value: event.target.value }); }} aria-label="Текст элемента" />
            </section>

            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Вычисленные стили</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {styleEntries.length ? styleEntries.map(([property, value]) => (
                  <label key={`${element?.locator.selector}:${property}`} className="min-w-0 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
                    <span className="block truncate">{property}</span>
                    <input defaultValue={value} onBlur={(event) => { if (event.target.value !== value) onPatch({ kind: 'style', property, value: event.target.value }); }} className="mt-1 w-full bg-transparent font-mono text-xs text-foreground outline-none" />
                  </label>
                )) : <p className="text-sm text-muted-foreground">Стили появятся после выбора элемента.</p>}
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Атрибуты</p>
              <div className="space-y-2">
                {attributeEntries.map(([name, value]) => (
                  <label key={`${element?.locator.selector}:attr:${name}`} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs">
                    <span className="truncate text-muted-foreground">{name}</span>
                    <input defaultValue={value} onBlur={(event) => { if (event.target.value !== value) onPatch({ kind: 'attribute', name, value: event.target.value || null }); }} className="min-w-0 bg-transparent font-mono outline-none" />
                  </label>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      <form className="space-y-2 border-t bg-background p-4" onSubmit={(event) => { event.preventDefault(); const value = prompt.trim(); if (!value || busy || !element) return; onEditWithAi(value); }}>
        <label htmlFor="site-code-ai-prompt" className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="size-4 text-blue-500" />Изменить выбранный элемент с ИИ</label>
        <textarea id="site-code-ai-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!element || busy} rows={2} maxLength={2000} placeholder="Опишите точное изменение этого элемента" className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60" />
        <div className="flex items-center justify-between gap-3">
          <p className={cn('min-w-0 truncate text-xs text-muted-foreground', status === 'error' && 'text-destructive')}>{message || 'Изменения сохраняются как черновик до общей публикации.'}</p>
          <Button type="submit" size="sm" className="shrink-0 gap-1.5" disabled={!element || !prompt.trim() || busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Изменить</Button>
        </div>
      </form>
    </aside>
  );
}
