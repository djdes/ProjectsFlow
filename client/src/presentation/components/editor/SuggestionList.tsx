import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SuggestionItem {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  // Превью-карточка справа (Notion-style): как будет выглядеть этот тип блока.
  preview?: React.ReactNode;
  // Подпись под превью (что делает этот пункт).
  description?: string;
  // Произвольная нагрузка (например, run для slash-команд) — список её не трогает.
  [key: string]: unknown;
}

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SuggestionListProps {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void;
}

// Универсальный клавиатурно-навигируемый список для slash-меню и @-упоминаний.
export const SuggestionList = React.forwardRef<SuggestionListHandle, SuggestionListProps>(
  function SuggestionList({ items, command }, ref) {
    const [index, setIndex] = React.useState(0);

    React.useEffect(() => {
      setIndex(0);
    }, [items]);

    const select = React.useCallback(
      (i: number): void => {
        const it = items[i];
        if (it) command(it);
      },
      [items, command],
    );

    React.useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (event) => {
          if (!items.length) return false;
          if (event.key === 'ArrowUp') {
            setIndex((i) => (i + items.length - 1) % items.length);
            return true;
          }
          if (event.key === 'ArrowDown') {
            setIndex((i) => (i + 1) % items.length);
            return true;
          }
          if (event.key === 'Enter') {
            select(index);
            return true;
          }
          return false;
        },
      }),
      [items, index, select],
    );

    if (!items.length) {
      return (
        <div className="min-w-[12rem] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Ничего не найдено</div>
        </div>
      );
    }

    const active = items[index];
    return (
      // relative-обёртка: список слева, превью-карточка активного пункта справа (Notion-style).
      <div className="relative flex items-start">
        <div className="max-h-72 min-w-[14rem] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                i === index ? 'bg-active text-foreground' : 'hover:bg-hover',
              )}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(i);
              }}
            >
              {it.icon ? (
                <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  {it.icon}
                </span>
              ) : null}
              <span className="flex-1 truncate">{it.label}</span>
              {it.hint ? (
                <span className="shrink-0 text-xs text-muted-foreground">{it.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
        {/* Превью активного пункта — тёмная карточка справа: сверху пример рендера блока,
            снизу подпись (что делает пункт). Показываем только если у пункта есть preview. */}
        {active?.preview ? (
          <div className="pointer-events-none ml-2 hidden w-56 shrink-0 overflow-hidden rounded-lg bg-neutral-900 shadow-xl ring-1 ring-black/20 sm:block">
            <div className="min-h-[4.5rem] bg-neutral-800/60 px-3.5 py-3 text-neutral-100">
              {active.preview}
            </div>
            {active.description ? (
              <div className="px-3.5 py-2.5 text-xs leading-snug text-neutral-400">
                {active.description}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);
