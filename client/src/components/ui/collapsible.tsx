import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Минимальный collapsible на useState + aria-expanded/aria-controls — без radix:
 * поведение здесь исчерпывается «кнопка показывает/прячет область», и новая
 * зависимость ради этого не окупается.
 *
 * Анимация раскрытия намеренно оставлена CSS-переходом высоты у самого контента:
 * в globals.css html.pf-no-motion и prefers-reduced-motion глушат transition
 * глобально, поэтому отдельного гейта здесь не требуется.
 */
export function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  trigger,
  triggerClassName,
  contentClassName,
  chevron = true,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: React.ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  chevron?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const contentId = useId();
  const open = controlledOpen ?? uncontrolledOpen;

  const toggle = (): void => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
          triggerClassName,
        )}
      >
        {chevron && (
          <ChevronRight
            aria-hidden="true"
            className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
        )}
        {trigger}
      </button>
      {/* hidden вместо размонтирования: содержимое остаётся в DOM для поиска по
          странице и не теряет состояние вложенных раскрытых пунктов. */}
      <div id={contentId} hidden={!open} className={contentClassName}>
        {children}
      </div>
    </div>
  );
}
