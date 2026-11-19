import { useRef } from 'react';
import { cn } from '@/lib/utils';
import type { MailingLayout } from '@/domain/mailing/Mailing';
import { MAILING_LAYOUT_OPTIONS, layoutThumbUrl } from './mailingFormat';

// Letter design picker: a radio group of hero thumbnails. Arrow keys move the choice,
// like native radios; the grid reflows from two columns on phones to a single row.
export function MailingLayoutPicker({ value, onChange }: { value: MailingLayout; onChange: (layout: MailingLayout) => void }): React.ReactElement {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, MAILING_LAYOUT_OPTIONS.findIndex((o) => o.value === value));

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + MAILING_LAYOUT_OPTIONS.length) % MAILING_LAYOUT_OPTIONS.length;
    onChange(MAILING_LAYOUT_OPTIONS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className="space-y-1.5">
      <span id="mailing-layout-label" className="text-sm font-medium">Макет</span>
      <div
        role="radiogroup"
        aria-labelledby="mailing-layout-label"
        onKeyDown={onKeyDown}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(6.25rem,30%),1fr))] gap-2"
        data-pf-mailing-layouts
      >
        {MAILING_LAYOUT_OPTIONS.map((o, i) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn(
                'group min-w-0 rounded-md p-1 text-start outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'bg-primary-soft ring-2 ring-primary' : 'hover:bg-hover',
              )}
            >
              <img
                src={layoutThumbUrl(o.value)}
                alt=""
                width={140}
                height={90}
                loading="lazy"
                className="block aspect-[14/9] w-full rounded-sm bg-muted object-cover"
              />
              <span className={cn('block truncate pbs-1 text-xs font-medium', selected && 'text-primary-ink')}>{o.label}</span>
              <span className="block truncate text-2xs text-muted-foreground">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
