import type { ComponentType, ReactNode } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Shared states of the admin tabs: one look for loading, empty and failed sections.

// Admin list surface (C4 card on the sheet): rows divided by hairlines.
export const ADMIN_LIST_CLASS = 'divide-y divide-border overflow-clip rounded-lg bg-card shadow-card';

export function AdminLoading({ rows = 5, className }: { rows?: number; className?: string }): React.ReactElement {
  return (
    <LoadingRegion className={cn('overflow-clip rounded-lg bg-card shadow-card', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-be border-border px-3 py-2.5 last:border-be-0">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

export function AdminEmpty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg bg-panel px-4 py-10 text-center" data-admin-empty>
      {Icon && <Icon className="mbe-1 size-5 text-muted-foreground" />}
      <p className="text-ui font-medium">{title}</p>
      {children && <p className="max-w-sm text-meta text-muted-foreground">{children}</p>}
      {action && <div className="mbs-2">{action}</div>}
    </div>
  );
}

export function AdminError({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-destructive-soft px-3 py-2.5 text-ui text-destructive">
      <AlertCircle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onRetry}>
          <RotateCw className="size-3.5" /> Повторить
        </Button>
      )}
    </div>
  );
}

export const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;
