import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useSidebarSectionCollapse } from '@/presentation/hooks/useSidebarSectionCollapse';
import { useRecentTasks } from '@/presentation/hooks/useRecentTasks';
import { RecentTaskRow } from '@/presentation/components/recent/RecentTaskRow';

// Блок «Недавнее» над поиском проектов: последние открытые задачи. Клик → доска проекта
// + открытая карточка (?task=). Минималистично: одна иконка-раскрытие (без часов), строки
// без названия проекта/времени. «ещё» раскрывает остальные (макс 10) прямо в блоке — без
// отдельного окна. Свёрнутость персистится; анимации уважают MotionProvider.
const PREVIEW_LIMIT = 3;
const MAX_LIMIT = 10;

export function RecentTasksBlock(): React.ReactElement | null {
  const { animations } = useMotion();
  const { collapsed, toggle } = useSidebarSectionCollapse('recent', false);
  const { items } = useRecentTasks(MAX_LIMIT);
  const [expanded, setExpanded] = useState(false);

  // Пока нет ни одной открытой задачи — блок не показываем (в т.ч. на первой загрузке).
  if (items.length === 0) return null;

  const visible = expanded ? items.slice(0, MAX_LIMIT) : items.slice(0, PREVIEW_LIMIT);
  const showToggle = items.length > PREVIEW_LIMIT;

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="group flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn('size-3 shrink-0 opacity-0 transition-all group-hover:opacity-100', collapsed && '-rotate-90')}
        />
        <span>Недавнее</span>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="recent-body"
            initial={animations ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              animations ? { type: 'spring', stiffness: 420, damping: 36 } : { duration: 0 }
            }
            className="overflow-hidden"
          >
            <motion.ul
              className="mt-0.5 space-y-1"
              initial={animations ? 'hidden' : false}
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.04 } } }}
            >
              {visible.map((item) => (
                <motion.li
                  key={item.taskId}
                  variants={{
                    hidden: { opacity: 0, y: -4 },
                    show: { opacity: 1, y: 0 },
                  }}
                >
                  <NavLink
                    to={`/projects/${item.projectId}?task=${item.taskId}`}
                    className="flex items-center gap-2 rounded-md px-2 py-2 transition-all hover:translate-x-0.5 hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <RecentTaskRow item={item} />
                  </NavLink>
                </motion.li>
              ))}
            </motion.ul>

            {/* «ещё»/«скрыть» — выровнено по строкам действий (иконка-шеврон в size-5 слоте +
                текст), раскрывает/сворачивает остальные прямо в блоке. */}
            {showToggle && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
              >
                <span className="grid size-5 shrink-0 place-items-center">
                  <ChevronDown
                    className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                  />
                </span>
                {expanded ? 'скрыть' : 'ещё'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
