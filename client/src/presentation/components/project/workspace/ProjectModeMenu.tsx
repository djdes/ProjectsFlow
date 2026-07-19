import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, LayoutGrid, PanelsTopLeft, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function ProjectModeMenu({ projectId, mode }: { projectId: string; mode: 'tasks' | 'studio' }): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const show = (): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = (): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const selectMode = (next: 'tasks' | 'studio'): void => {
    setOpen(false);
    if (next === mode) return;
    navigate(next === 'tasks' ? `/projects/${projectId}` : `/projects/${projectId}/studio`);
  };

  return (
    <div ref={rootRef} className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onFocus={show}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Переключить режим проекта"
        className={cn(
          'group inline-flex size-8 items-center justify-center gap-0.5 rounded-lg border border-transparent text-muted-foreground transition-all hover:border-border hover:bg-background hover:text-foreground hover:shadow-sm',
          mode === 'studio' && 'bg-gradient-to-br from-violet-500/10 to-cyan-500/10 text-violet-600 dark:text-violet-300',
          open && 'border-border bg-background text-foreground shadow-sm',
        )}
      >
        {mode === 'tasks' ? <LayoutGrid className="size-4" /> : <PanelsTopLeft className="size-4" />}
        <ChevronDown className={cn('size-2.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" aria-label="Режим проекта" className="absolute right-0 top-10 z-[90] w-[292px] origin-top-right animate-in fade-in-0 zoom-in-95 rounded-2xl border bg-popover p-2 shadow-2xl" onFocus={show} onBlur={hide}>
          <div className="px-2 pb-2 pt-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Режим проекта</p>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">Задачи и создание результата живут рядом и сохраняют общий контекст.</p>
          </div>
          {([
            { id: 'tasks' as const, label: 'Задачи', description: 'Доска, таблица, список и календарь', icon: LayoutGrid, iconClass: 'bg-muted text-foreground' },
            { id: 'studio' as const, label: 'Студия', description: 'ИИ-чат, Preview, Dashboard и редактор', icon: Sparkles, iconClass: 'bg-gradient-to-br from-violet-500/15 to-cyan-500/15 text-violet-600 dark:text-violet-300' },
          ]).map((item) => {
            const active = mode === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => selectMode(item.id)}
                className={cn(
                  'group flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:bg-hover',
                  active && 'border-border bg-muted/55 shadow-sm',
                )}
              >
                <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl', item.iconClass)}><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">{item.label}{active && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Сейчас</span>}</span>
                  <span className="mt-1 block text-xs leading-4 text-muted-foreground">{item.description}</span>
                </span>
                {active ? <Check className="mt-1 size-4 shrink-0 text-primary" /> : <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
