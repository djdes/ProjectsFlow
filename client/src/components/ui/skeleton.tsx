import { useLayoutEffect, type HTMLAttributes, type ReactNode } from 'react';
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

/** Every shimmer runs from the timeline origin, so a skeleton that replaces another one
 * (boot screen → shell → page) continues the sweep instead of restarting it. */
export function syncSkeletonShimmer(): void {
  for (const animation of document.getAnimations?.() ?? []) {
    if ((animation as CSSAnimation).animationName === 'pf-skeleton-sweep') animation.startTime = 0;
  }
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
  useLayoutEffect(syncSkeletonShimmer, []);
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
