import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { Card, CardContent } from '@/components/ui/card';
import type { Task } from '@/domain/task/Task';

// Count-up: плавно тикает от prev до target за 600ms (easeOut). Без зависимостей кроме motion.
function useCountUp(value: number, duration = 0.6): number {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current === value) return;
    const controls = animate(prevRef.current, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (latest) => setDisplayed(latest),
    });
    prevRef.current = value;
    return () => controls.stop();
  }, [value, duration]);

  return displayed;
}

type Props = {
  tasks: Task[];
};

type Stats = {
  todo: number;
  inProgress: number;
  done: number;
  total: number;
  donePercent: number;
  inProgressPercent: number;
};

function computeStats(tasks: Task[]): Stats {
  let todo = 0;
  let inProgress = 0;
  let done = 0;
  for (const t of tasks) {
    if (t.status === 'todo') todo++;
    else if (t.status === 'in_progress') inProgress++;
    else done++;
  }
  const total = tasks.length;
  const donePercent = total > 0 ? (done / total) * 100 : 0;
  const inProgressPercent = total > 0 ? (inProgress / total) * 100 : 0;
  return { todo, inProgress, done, total, donePercent, inProgressPercent };
}

export function PipelinePanel({ tasks }: Props): React.ReactElement {
  const s = computeStats(tasks);
  // Hooks должны быть до conditional return.
  const animatedPercent = useCountUp(s.donePercent);
  const donePctRounded = Math.round(animatedPercent);
  const isComplete = s.total > 0 && s.done === s.total;

  if (s.total === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Пайплайн разработки
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Пока пусто — добавь первую задачу.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Пайплайн разработки
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isComplete
                ? 'Все задачи завершены 🎉'
                : `Завершено ${s.done} из ${s.total} задач`}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
              {donePctRounded}
              <span className="text-xl text-muted-foreground">%</span>
            </p>
          </div>
        </div>

        {/* Stacked bar: done (зелёный) + in_progress (синий) на muted-фоне = todo.
            donePercent тикается синхронно с count-up числом; in_progress анимируется CSS. */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-500 dark:bg-emerald-400"
            style={{ width: `${animatedPercent}%` }}
          />
          <div
            className="h-full bg-blue-500 transition-[width] duration-500 ease-out dark:bg-blue-400"
            style={{ width: `${s.inProgressPercent}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          <LegendItem dotClass="bg-emerald-500 dark:bg-emerald-400" label="Готово" count={s.done} />
          <LegendItem dotClass="bg-blue-500 dark:bg-blue-400" label="В работе" count={s.inProgress} />
          <LegendItem dotClass="bg-muted-foreground/30" label="TODO" count={s.todo} />
          <span className="ml-auto text-muted-foreground">
            Всего <span className="font-medium text-foreground">{s.total}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function LegendItem({
  dotClass,
  label,
  count,
}: {
  dotClass: string;
  label: string;
  count: number;
}): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
      {label} <span className="font-medium text-foreground">{count}</span>
    </span>
  );
}
