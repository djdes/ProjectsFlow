import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  projectId: string;
  taskId: string;
  // Версия задачи (обычно updatedAt): изменилась — сводку перечитываем.
  revision?: Date | string | number | null;
  className?: string;
};

// Сводка ИИ «что сделано» для задачи на утверждении: до трёх приглушённых строк с искрой.
// Грузится лениво — только когда карточка показалась на экране (IntersectionObserver), из
// общего кэша контейнера, поэтому повторные рендеры и окно «Принять все» не шлют повторных
// запросов. Сводки нет (задача не на утверждении, данных о работе нет, ИИ недоступен) —
// не рисуем ничего.
export function ApprovalSummary({ projectId, taskId, revision, className }: Props): React.ReactElement | null {
  const { loadApprovalSummary } = useContainer();
  const revisionKey = revision == null ? null : String(new Date(revision).getTime());
  const id = `${projectId}/${taskId}@${revisionKey ?? ''}`;
  const cached = loadApprovalSummary.peek({ projectId, taskId, revision: revisionKey });
  const [loaded, setLoaded] = useState<{ id: string; summary: string | null } | null>(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // undefined — ещё не знаем, null — сводки нет.
  const summary = cached !== undefined ? cached.summary : loaded?.id === id ? loaded.summary : undefined;
  const pending = summary === undefined;

  useEffect(() => {
    if (!pending || visible) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    // Небольшой запас по краю: сводка успевает подгрузиться, пока карточку доматывают.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: '120px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [pending, visible]);

  useEffect(() => {
    if (!visible || !pending) return;
    let alive = true;
    loadApprovalSummary.execute({ projectId, taskId, revision: revisionKey }).then(
      (result) => {
        if (alive) setLoaded({ id, summary: result.summary });
      },
      () => {
        // Сеть подвела — сводка необязательна: карточка остаётся без неё, без ошибки поверх работы.
        if (alive) setLoaded({ id, summary: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [visible, pending, id, projectId, taskId, revisionKey, loadApprovalSummary]);

  if (summary === null) return null;
  if (summary === undefined) {
    return (
      <div ref={ref} className={cn('flex items-center gap-1.5 pbs-0.5', className)} data-pf-approval-summary="loading">
        <Sparkles aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        <Skeleton className="h-2.5 w-4/5 rounded-sm" />
      </div>
    );
  }
  return (
    <div
      className={cn('flex items-start gap-1.5 text-meta leading-snug text-muted-foreground', className)}
      data-pf-approval-summary="ready"
      title={summary}
    >
      <Sparkles aria-hidden className="mbs-[0.2em] size-3 shrink-0 text-primary" />
      <p className="min-w-0 whitespace-pre-line line-clamp-3">
        <span className="sr-only">Сводка ИИ: </span>
        {summary}
      </p>
    </div>
  );
}
