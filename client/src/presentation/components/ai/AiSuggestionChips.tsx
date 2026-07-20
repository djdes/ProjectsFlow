import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Lightbulb } from 'lucide-react';
import type { AiSuggestion } from '@/domain/ai-chat/AiSuggestion';
import { cn } from '@/lib/utils';

/**
 * Блок подсказок над композером. Геометрия снята с base44 один в один:
 * контейнер `py-3` + `gap 10px` (80px развёрнут / 42px свёрнут), заголовок-кнопка 18px
 * с лампочкой и `aria-expanded`, чип 28px / радиус 9999 / паддинг 0 8 / шрифт 12-16 /
 * gap 6, ряд с `gap 4` и скрытым скроллбаром, одна кнопка пагинации 24×24 у правого
 * края, которая переобозначается вместо второй стрелки.
 *
 * Клик по чипу ЗАПОЛНЯЕТ композер и НЕ отправляет — фокус остаётся на чипе.
 */
export function AiSuggestionChips({
  suggestions,
  onPick,
  className,
}: {
  suggestions: readonly AiSuggestion[];
  onPick: (prompt: string) => void;
  className?: string;
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(true);
  const row = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  const measure = useCallback((): void => {
    const element = row.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    setOverflowing(max > 1);
    setAtEnd(max > 1 && element.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    measure();
    const element = row.current;
    // ResizeObserver ловит и смену ширины панели (сплит-пейн тянут мышью), и смену
    // содержимого ряда. Без него кнопка пагинации застревала бы в состоянии первого рендера.
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, measure, suggestions]);

  if (suggestions.length === 0) return null;

  // Как в референсе: один клик уводит ряд сразу в конец, второй — обратно в начало.
  const page = (): void => {
    const element = row.current;
    if (!element) return;
    element.scrollTo({ left: atEnd ? 0 : element.scrollWidth, behavior: 'smooth' });
  };

  return (
    <div className={cn('flex flex-col gap-2.5 py-3', className)} data-testid="ai-chat-suggestions">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-fit items-center gap-1 rounded text-xs font-medium leading-4 text-foreground/80 transition-colors hover:text-foreground"
      >
        <Lightbulb className="size-[18px] shrink-0" aria-hidden />
        Подсказки
      </button>
      {/* Свёрнутый блок УДАЛЯЕТ чипы из DOM (референс), а не прячет их видимостью. */}
      {expanded && (
        <div className="relative">
          <div
            ref={row}
            onScroll={measure}
            className="pf-scrollbar-hide flex items-center gap-1 overflow-x-auto"
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => onPick(suggestion.prompt)}
                title={suggestion.prompt}
                className={cn(
                  'inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2',
                  'bg-message-bubble text-xs font-medium leading-4 text-foreground',
                  'transition-colors duration-150 hover:border-border hover:bg-accent',
                )}
              >
                <span className="min-w-0 truncate">{suggestion.title}</span>
              </button>
            ))}
          </div>
          {overflowing && (
            <>
              {/* Кнопка нарисована ПОВЕРХ затухающих чипов (референс), поэтому сама она
                  прозрачная, а край ряда гасит узкий градиент — иначе последний чип
                  обрывался бы посреди буквы. */}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-background via-background to-transparent" />
              <button
                type="button"
                onClick={page}
                aria-label={atEnd ? 'Прокрутить подсказки влево' : 'Прокрутить подсказки вправо'}
                title={atEnd ? 'Прокрутить подсказки влево' : 'Прокрутить подсказки вправо'}
                className={cn(
                  'absolute right-0 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded border border-transparent',
                  'text-muted-foreground transition hover:text-foreground',
                )}
              >
                <ChevronRight className={cn('size-4 transition-transform', atEnd && 'rotate-180')} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
