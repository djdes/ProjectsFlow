import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronDown, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';
import { Highlight } from '@/presentation/components/search/Highlight';

const PREVIEW_LIMIT = 3;
const MAX_LIMIT = 10;

// Результаты поиска по задачам в сайдбаре — визуально как блок «Недавнее»: документ-иконка +
// подсвеченный отрывок описания. До 3 строк, «ещё» раскрывает до 10. Сортировка (по дате
// создания) приходит из useSidebarTaskSearch. Клик → доска проекта + открытая карточка.
export function SidebarTaskResults({
  results,
  query,
}: {
  results: TaskSearchResult[];
  query: string;
}): React.ReactElement | null {
  const { animations } = useMotion();
  const [expanded, setExpanded] = useState(false);

  // Новый запрос — снова показываем только превью (3).
  useEffect(() => {
    setExpanded(false);
  }, [query]);

  if (results.length === 0) return null;

  const visible = expanded ? results.slice(0, MAX_LIMIT) : results.slice(0, PREVIEW_LIMIT);
  const showToggle = results.length > PREVIEW_LIMIT;

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground/80">
        <span>Задачи</span>
        <span className="tabular-nums opacity-70">{Math.min(results.length, MAX_LIMIT)}</span>
      </div>

      <motion.ul
        className="mt-0.5 space-y-1"
        initial={animations ? 'hidden' : false}
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.04 } } }}
      >
        {visible.map((r) => (
          <motion.li
            key={r.taskId}
            variants={{ hidden: { opacity: 0, y: -4 }, show: { opacity: 1, y: 0 } }}
          >
            <NavLink
              to={`/projects/${r.projectId}?task=${r.taskId}`}
              className="flex items-center gap-2 rounded-md px-2 py-2 transition-all hover:translate-x-0.5 hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm leading-snug">
                <Highlight text={r.excerpt || '(без описания)'} query={query} />
              </span>
            </NavLink>
          </motion.li>
        ))}
      </motion.ul>

      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <span className="grid size-5 shrink-0 place-items-center">
            <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
          </span>
          {expanded ? 'скрыть' : 'ещё'}
        </button>
      )}
    </div>
  );
}
