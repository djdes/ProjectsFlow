import type { ReactElement, ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RUN_MODE_META, RUN_MODES, type RunMode } from '@/domain/task/Task';
import { cn } from '@/lib/utils';
import { WORKER_HANDOFF_LABEL } from './workerHandoff';

// «Передать воркеру» в один клик уводил задачу в очередь режимом по умолчанию — человек
// не успевал выбрать «Полный прогон» (диспетчер забирал задачу раньше). Теперь клик
// открывает маленькое меню: какой режим запуска; текущий режим задачи — первым и отмечен.
export function WorkerHandoffMenu({
  runMode,
  onPick,
  className,
  children,
}: {
  runMode: RunMode;
  onPick: (mode: RunMode) => void;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const current: RunMode = runMode === 'full' ? 'full' : 'quick';
  const ordered = [current, ...RUN_MODES.filter((mode) => mode !== current)];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={WORKER_HANDOFF_LABEL}
          title={WORKER_HANDOFF_LABEL}
          className={className}
          data-pf-worker-handoff=""
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">{WORKER_HANDOFF_LABEL} — режим запуска</DropdownMenuLabel>
        {ordered.map((mode) => (
          <DropdownMenuItem
            key={mode}
            data-run-mode={mode}
            className="items-start py-2"
            onSelect={() => onPick(mode)}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={cn('text-sm', mode === current && 'font-medium')}>
                {RUN_MODE_META[mode].label}
                {mode === current && <span className="text-muted-foreground"> · сейчас</span>}
              </span>
              <span className="text-2xs leading-snug text-muted-foreground">{RUN_MODE_META[mode].description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
