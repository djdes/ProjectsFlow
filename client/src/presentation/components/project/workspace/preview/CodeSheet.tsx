import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { InspectedElement } from './types';

export function CodeSheet({ open, onOpenChange, element }: { open: boolean; onOpenChange: (open: boolean) => void; element: InspectedElement | null }): React.ReactElement {
  const source = element?.source || 'Исходный фрагмент недоступен. Подключённый preview bridge должен отправить безопасный snapshot элемента.';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4 text-left"><SheetTitle>Код элемента</SheetTitle><SheetDescription>{element ? `${element.locator.tagName.toLowerCase()} · ${element.locator.selector}` : 'Сначала выберите элемент в Preview.'}</SheetDescription></SheetHeader>
        <div className="flex items-center justify-end border-b px-3 py-2"><Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!element?.source} onClick={() => void navigator.clipboard?.writeText(source)}><Copy className="size-3.5" />Копировать</Button></div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 p-5 font-mono text-xs leading-5 text-zinc-100" tabIndex={0}>{source}</pre>
      </SheetContent>
    </Sheet>
  );
}
