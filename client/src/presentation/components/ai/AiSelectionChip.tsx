import { SquareMousePointer } from 'lucide-react';
import type { AiSelectionRef } from '@/domain/ai-chat/AiSelectionRef';
import { cn } from '@/lib/utils';

// Геометрия снята с бейджа зоны в пузыре пользователя у base44: высота 20, радиус 4,
// паддинг 2/6, gap 4, шрифт 12/16, глиф + имя тега, инверсная заливка. `rounded` в
// Tailwind — это ровно 4px (в конфиге переопределены только lg/md/sm).
//
// Одно расхождение с референсом сделано осознанно: там бейдж инертен (cursor:auto, без
// role и title), у нас это кнопка «показать зону» — по прямому требованию владельца.
const CHIP = 'inline-flex h-5 min-w-0 max-w-full shrink-0 items-center gap-1 rounded bg-foreground px-1.5 py-0.5 text-xs font-medium leading-4 text-background';

export function AiSelectionChip({
  selection,
  onOpen,
}: {
  selection: AiSelectionRef;
  // Без колбэка чип остаётся read-only отметкой: в личном чате и на страницах без
  // предпросмотра открывать зону негде, а мёртвая кнопка хуже подписи.
  onOpen?: (selection: AiSelectionRef) => void;
}): React.ReactElement {
  const title = [selection.label, selection.route, selection.selector].filter(Boolean).join(' · ');
  const body = (
    <>
      <SquareMousePointer className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{selection.tagName}</span>
    </>
  );

  if (!onOpen) return <span className={CHIP} title={title}>{body}</span>;

  return (
    <button
      type="button"
      onClick={() => onOpen(selection)}
      title={title}
      aria-label={`Показать зону ${selection.tagName} в редакторе: ${selection.selector}`}
      className={cn(
        CHIP,
        'cursor-pointer transition-colors hover:bg-foreground/85',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-muted',
      )}
    >
      {body}
    </button>
  );
}
