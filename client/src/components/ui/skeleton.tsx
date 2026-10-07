import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Decorative geometry only; announce loading once at the enclosing region. */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn('pf-skeleton rounded-md', className)}
    />
  );
}

export function LoadingRegion({
  children,
  className,
  label = 'Загружаем…',
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}): React.ReactElement {
  return (
    <div
      className={className}
      role="status"
      aria-busy="true"
      data-pf-loading="true"
    >
      {children}
      <span className="sr-only">{label}</span>
    </div>
  );
}
