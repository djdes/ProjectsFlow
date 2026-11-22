import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Список-группа настроек в стиле iOS / приложения Claude: подпись группы над скруглённой
// плашкой, строки ≥52px с иконкой слева и значением/стрелкой справа, разделители с отступом
// от иконки (а не на всю ширину).

export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={cn('space-y-1.5', className)}>
      {title ? <h3 className="px-4 text-meta font-medium text-muted-foreground">{title}</h3> : null}
      <div className="overflow-clip rounded-xl bg-card shadow-card [&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:inset-bs-0 [&>*+*]:before:end-0 [&>*+*]:before:start-12 [&>*+*]:before:h-px [&>*+*]:before:bg-border [&>*+*]:before:content-['']">
        {children}
      </div>
      {description ? <p className="px-4 text-meta text-muted-foreground">{description}</p> : null}
    </section>
  );
}

type RowBase = {
  icon?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Value or control on the right (Switch, текущее значение). */
  trailing?: React.ReactNode;
  /** Show a chevron — the row navigates somewhere. */
  chevron?: boolean;
  className?: string;
};

function RowInner({ icon, label, description, trailing, chevron }: RowBase): React.ReactElement {
  return (
    <>
      <span className="grid size-6 shrink-0 place-items-center text-muted-foreground [&_svg]:size-[18px]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">{label}</span>
        {description ? <span className="mbs-0.5 block text-meta text-muted-foreground">{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-sm text-muted-foreground">{trailing}</span> : null}
      {chevron ? <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" /> : null}
    </>
  );
}

const ROW_CLASS = 'flex min-h-[3.25rem] w-full items-center gap-3 px-3 py-2.5 text-start';

/** Static row (text, or a control in `trailing`). */
export function SettingsRow(props: RowBase): React.ReactElement {
  return (
    <div className={cn(ROW_CLASS, props.className)}>
      <RowInner {...props} />
    </div>
  );
}

/** Pressable row: pass `asChild` content via `render` (e.g. a router Link) or `onClick`. */
export function SettingsButtonRow({
  onClick,
  render,
  ...props
}: RowBase & {
  onClick?: () => void;
  render?: (args: { className: string; children: React.ReactNode }) => React.ReactElement;
}): React.ReactElement {
  const className = cn(ROW_CLASS, 'transition-colors hover:bg-hover active:bg-active', props.className);
  const children = <RowInner {...props} />;
  if (render) return render({ className, children });
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
