import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';

type Props = {
  // markdown-текст задачи
  children: string;
  // доп. классы для Markdown (например line-through/opacity для выполненной задачи)
  className?: string;
};

// Текст задачи с «мягким» лимитом в 12 строк (site-wide правило авто-роста) и кнопкой
// «Показать полностью» / «Свернуть», если текст длиннее. Используется в плоских списках
// «Входящих» (TaskListView, блок «Поручено мне»), где раньше стоял жёсткий line-clamp-2.
//
// Свёрнутое состояние клампится через -webkit-line-clamp (line-clamp-[12]); переполнение
// определяется сравнением scrollHeight/clientHeight на корневом div Markdown. Флаг canExpand
// «липкий» — измеряем только пока свёрнуто, чтобы кнопка «Свернуть» не исчезала после раскрытия.
export function ExpandableMarkdown({ children, className }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    if (expanded) return; // меряем только в свёрнутом состоянии
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const measure = (): void => setCanExpand(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, expanded]);

  return (
    <div ref={ref}>
      <Markdown className={cn(MARKDOWN_COMPACT, className, !expanded && 'line-clamp-[12]')}>
        {children}
      </Markdown>
      {canExpand && (
        <button
          type="button"
          onClick={(e) => {
            // не открываем drawer задачи — клик только по кнопке
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-0.5 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      )}
    </div>
  );
}
