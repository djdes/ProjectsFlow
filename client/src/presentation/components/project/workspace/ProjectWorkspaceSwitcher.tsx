import { Database, Eye, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ProjectWorkspaceMode = 'tasks' | 'preview' | 'dashboard';

const ITEMS = [
  { id: 'tasks' as const, label: 'Задачи', icon: LayoutGrid },
  { id: 'preview' as const, label: 'Preview', icon: Eye },
  { id: 'dashboard' as const, label: 'Dashboard', icon: Database },
];

export function ProjectWorkspaceSwitcher({
  value,
  onChange,
}: {
  value: ProjectWorkspaceMode;
  onChange: (value: ProjectWorkspaceMode) => void;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Рабочая область проекта"
      className="mbe-3 inline-flex w-fit max-w-full items-center rounded-lg bg-foreground/[0.06] dark:border dark:border-border dark:bg-panel p-0.5"
    >
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
            value === id
              ? 'bg-background text-foreground shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
