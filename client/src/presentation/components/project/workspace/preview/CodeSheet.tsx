import { useEffect, useMemo, useState } from 'react';
import { Braces, Check, Copy, Eye, Loader2, Sparkles, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { InspectedElement, PreviewEditorState } from './types';

type CodeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  element: InspectedElement | null;
  status: PreviewEditorState['aiStatus'];
  message: string | null;
  onEditWithAi: (prompt: string) => void;
};

export function CodeSheet({ open, onOpenChange, element, status, message, onEditWithAi }: CodeSheetProps): React.ReactElement {
  const [tab, setTab] = useState<'preview' | 'source'>('source');
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState('');
  const source = element?.source || 'Исходный фрагмент недоступен. Подключённый preview bridge должен отправить безопасный snapshot элемента.';
  const busy = status === 'submitting' || status === 'queued' || status === 'running';
  const styleEntries = useMemo(() => Object.entries(element?.styles ?? {}).slice(0, 12), [element?.styles]);

  useEffect(() => {
    setCopied(false);
    setPrompt('');
  }, [element?.locator.selector]);

  const copy = async (): Promise<void> => {
    if (!element?.source) return;
    await navigator.clipboard?.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>Элемент и код</SheetTitle>
          <SheetDescription>{element ? `${element.locator.tagName.toLowerCase()} · ${element.locator.selector}` : 'Сначала выберите элемент в Preview.'}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Представление элемента">
            <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground', tab === 'preview' && 'bg-background text-foreground shadow-sm')}><Eye className="size-3.5" />Обзор</button>
            <button type="button" role="tab" aria-selected={tab === 'source'} onClick={() => setTab('source')} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground', tab === 'source' && 'bg-background text-foreground shadow-sm')}><Braces className="size-3.5" />Исходник</button>
          </div>
          <div className="flex items-center gap-1.5">
            {tab === 'source' && <Button type="button" variant="outline" size="icon" className="size-8" aria-label={wrap ? 'Не переносить длинные строки' : 'Переносить длинные строки'} aria-pressed={wrap} onClick={() => setWrap((value) => !value)}><WrapText className="size-3.5" /></Button>}
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" disabled={!element?.source} onClick={() => void copy()}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Скопировано' : 'Копировать'}</Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {tab === 'source' ? (
            <pre className={cn('min-h-full bg-zinc-950 p-5 font-mono text-xs leading-5 text-zinc-100', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')} tabIndex={0}>{source}</pre>
          ) : (
            <div className="space-y-4 p-5">
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Выбранный элемент</p>
                <p className="mt-2 font-medium">{element?.label ?? 'Элемент не выбран'}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{element?.locator.selector ?? '—'}</p>
                {element?.locator.text && <p className="mt-3 rounded-lg bg-background p-3 text-sm leading-6">{element.locator.text}</p>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {styleEntries.length ? styleEntries.map(([property, value]) => <div key={property} className="min-w-0 rounded-lg border px-3 py-2"><p className="truncate text-xs text-muted-foreground">{property}</p><p className="truncate font-mono text-xs">{value}</p></div>) : <p className="text-sm text-muted-foreground">Вычисленные стили недоступны.</p>}
              </div>
            </div>
          )}
        </div>

        <form className="space-y-2 border-t bg-background p-4" onSubmit={(event) => { event.preventDefault(); const value = prompt.trim(); if (!value || busy || !element) return; onEditWithAi(value); }}>
          <label htmlFor="site-code-ai-prompt" className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="size-4 text-blue-500" />Изменить код с ИИ</label>
          <textarea id="site-code-ai-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!element || busy} rows={3} maxLength={2000} placeholder="Например: сделай карточку компактнее, сохрани адаптивность и текущую логику" className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 disabled:opacity-60" />
          <div className="flex items-center justify-between gap-3">
            <p className={cn('min-w-0 truncate text-xs text-muted-foreground', status === 'error' && 'text-destructive')}>{message || 'ИИ подготовит черновик. На сайт он попадёт только после общей кнопки «Применить».'}</p>
            <Button type="submit" size="sm" className="shrink-0 gap-1.5" disabled={!element || !prompt.trim() || busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Изменить</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
