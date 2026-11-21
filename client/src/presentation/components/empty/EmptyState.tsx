import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EmptyStateAction = { label: string; icon?: LucideIcon; onClick: () => void };

// Пустой экран в духе приложения Claude: спокойный заголовок с засечками, одна строка
// подсказки и 1–3 чипа «что можно сделать» вместо серой надписи посреди пустоты.
export function EmptyState({
  title,
  hint,
  actions = [],
  className,
}: {
  title: string;
  hint?: string;
  actions?: readonly EmptyStateAction[];
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      <p className="max-w-[22rem] text-balance font-serif text-xl font-medium leading-snug text-foreground/85">{title}</p>
      {hint ? <p className="max-w-[20rem] text-ui text-muted-foreground">{hint}</p> : null}
      {actions.length > 0 && (
        <div className="mbs-3 flex flex-wrap justify-center gap-2">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-muted px-4 text-ui text-foreground transition-colors hover:bg-active active:bg-active"
            >
              {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
