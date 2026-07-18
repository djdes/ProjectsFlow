import { useRef, useState } from 'react';
import { Check, ChevronDown, LayoutGrid, PanelsTopLeft, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function ProjectModeMenu({ projectId, mode }: { projectId: string; mode: 'tasks' | 'studio' }): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const show = (): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = (): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };
  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onFocus={show}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Переключить режим проекта"
        className={cn('inline-flex size-8 items-center justify-center gap-0.5 rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground', open && 'bg-hover text-foreground')}
      >
        {mode === 'tasks' ? <LayoutGrid className="size-4" /> : <PanelsTopLeft className="size-4" />}
        <ChevronDown className="size-2.5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-[90] w-64 rounded-2xl border bg-popover p-1.5 shadow-2xl" onFocus={show} onBlur={hide}>
          <button type="button" role="menuitemradio" aria-checked={mode === 'tasks'} onClick={() => { setOpen(false); navigate(`/projects/${projectId}`); }} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-hover">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted"><LayoutGrid className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Задачи</span><span className="mt-0.5 block text-xs leading-4 text-muted-foreground">Доска, таблица, список и календарь</span></span>
            {mode === 'tasks' && <Check className="mt-1 size-4 text-primary" />}
          </button>
          <button type="button" role="menuitemradio" aria-checked={mode === 'studio'} onClick={() => { setOpen(false); navigate(`/projects/${projectId}/studio`); }} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-hover">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500/15 to-cyan-500/15 text-violet-600"><Sparkles className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Студия</span><span className="mt-0.5 block text-xs leading-4 text-muted-foreground">ИИ-чат, Preview, Dashboard и редактор</span></span>
            {mode === 'studio' && <Check className="mt-1 size-4 text-primary" />}
          </button>
        </div>
      )}
    </div>
  );
}
