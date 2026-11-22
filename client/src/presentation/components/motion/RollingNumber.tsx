import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { motionReduced } from '@/lib/liquidIndicator';

// Число, которое меняется на месте: старое уходит вверх (или вниз, если число уменьшилось) с
// коротким размытием, новое приходит с другой стороны — одна ячейка, без скачка ширины
// посреди смены (обе версии лежат в одной клетке сетки). Счётчики вкладок «Мои / Все»,
// разделов «В работе / Очередь», сроков. Движение — только без reduced-motion (CSS
// .pf-roll-* под prefers-reduced-motion: no-preference, «Анимации: выкл» глушит длительности).

type Exiting = { key: number; text: string; dir: 'up' | 'down' };

export function RollingNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}): React.ReactElement {
  const text = format ? format(value) : String(value);
  const previous = useRef<{ value: number; text: string }>({ value, text });
  const [exiting, setExiting] = useState<Exiting | null>(null);
  const [enterDir, setEnterDir] = useState<'up' | 'down' | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const prev = previous.current;
    if (prev.text === text) return undefined;
    const dir = value >= prev.value ? 'up' : 'down';
    previous.current = { value, text };
    // Без движения число просто меняется: двух версий в тексте не бывает ни на миг.
    if (motionReduced()) return undefined;
    setKey((k) => k + 1);
    setEnterDir(dir);
    setExiting({ key: Date.now(), text: prev.text, dir });
    const timer = window.setTimeout(() => setExiting(null), 320);
    return () => window.clearTimeout(timer);
  }, [text, value]);

  return (
    <span className={cn('pf-roll inline-grid tabular-nums', className)}>
      {exiting && (
        <span key={`x${exiting.key}`} aria-hidden className={cn('pf-roll-out', exiting.dir === 'up' ? 'pf-roll-up' : 'pf-roll-down')}>
          {exiting.text}
        </span>
      )}
      <span key={key} className={cn(enterDir && 'pf-roll-in', enterDir === 'down' ? 'pf-roll-down' : 'pf-roll-up')}>
        {text}
      </span>
    </span>
  );
}
