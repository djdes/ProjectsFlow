import { useEffect, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { InspectedElement } from './types';

export function AiPromptSheet({ open, onOpenChange, element, status, message, onSubmit }: {
  open: boolean; onOpenChange: (open: boolean) => void; element: InspectedElement | null;
  status: 'idle' | 'submitting' | 'queued' | 'running' | 'completed' | 'error'; message: string | null; onSubmit: (prompt: string) => void;
}): React.ReactElement {
  const [prompt, setPrompt] = useState('');
  useEffect(() => { if (!open) setPrompt(''); }, [open]);
  const busy = status === 'submitting' || status === 'queued' || status === 'running';
  const buttonLabel = status === 'submitting' || status === 'queued'
    ? 'Принято'
    : status === 'running'
      ? 'ИИ работает'
      : 'Передать ИИ';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4 text-left"><SheetTitle className="flex items-center gap-2"><Sparkles className="size-4 text-blue-500" />Изменить с ИИ</SheetTitle><SheetDescription>{element ? `ИИ получит только выбранный ${element.locator.tagName.toLowerCase()}, ограниченный snapshot и ваш запрос.` : 'Выберите область, блок, кнопку, текст или изображение.'}</SheetDescription></SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          {element && <div className="rounded-lg border bg-muted/30 p-3 text-xs"><p className="font-medium">{element.label}</p><p className="mt-1 truncate text-muted-foreground">{element.locator.selector}</p></div>}
          <label htmlFor="site-editor-ai-prompt" className="text-sm font-medium">Что изменить только в этом элементе?</label>
          <textarea id="site-editor-ai-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2_000} rows={8} placeholder="Например: сделай кнопку контрастнее, увеличь отступы и сохрани текущий текст" className="min-h-36 resize-y rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
          <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{prompt.length}/2000</span>{status !== 'idle' && <span role="status" aria-live="polite" className={status === 'error' ? 'text-destructive' : ''}>{message ?? status}</span>}</div>
          <Button type="button" className="self-end gap-1.5" disabled={!element || !prompt.trim() || busy} aria-disabled={busy} onClick={() => onSubmit(prompt)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{buttonLabel}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
