import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Clock, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useSidebarSectionCollapse } from '@/presentation/hooks/useSidebarSectionCollapse';
import { useRecentTasks } from '@/presentation/hooks/useRecentTasks';
import { RecentTaskRow } from '@/presentation/components/recent/RecentTaskRow';
import { RecentTasksDialog } from '@/presentation/components/recent/RecentTasksDialog';

// Блок «Недавнее» над поиском проектов: последние 3 открытые задачи. Клик → доска
// проекта + открытая карточка (?task=). «Вся история» — диалог с бо́льшим списком.
// Свёрнутость персистится в localStorage; анимации уважают MotionProvider.
const PREVIEW_LIMIT = 3;

export function RecentTasksBlock(): React.ReactElement | null {
  const { animations } = useMotion();
  const { collapsed, toggle } = useSidebarSectionCollapse('recent', false);
  const { items } = useRecentTasks(PREVIEW_LIMIT);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Пока нет ни одной открытой задачи — блок не показываем (в т.ч. на первой загрузке).
  if (items.length === 0) return null;

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn('size-3 shrink-0 transition-transform', collapsed && '-rotate-90')}
        />
        <Clock className="size-3 shrink-0" />
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
              className="mt-0.5 space-y-0.5"
              initial={animations ? 'hidden' : false}
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.04 } } }}
            >
              {items.map((item) => (
                <motion.li
                  key={item.taskId}
                  variants={{
                    hidden: { opacity: 0, y: -4 },
                    show: { opacity: 1, y: 0 },
                  }}
                >
                  <NavLink
                    to={`/projects/${item.projectId}?task=${item.taskId}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-all hover:translate-x-0.5 hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <RecentTaskRow item={item} />
                  </NavLink>
                </motion.li>
              ))}
            </motion.ul>

            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
            >
              <History className="size-3 shrink-0" />
              Показать больше
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <RecentTasksDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
