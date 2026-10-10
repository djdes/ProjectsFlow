import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronDown, FileText, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';
import { Highlight } from '@/presentation/components/search/Highlight';

const PREVIEW_LIMIT = 3;
const MAX_LIMIT = 10;

// Результаты поиска по задачам в сайдбаре — визуально как блок «Недавнее»: документ-иконка +
// подсвеченный отрывок описания. До 3 строк, «ещё» раскрывает до 10. Сортировка (по дате
// создания) приходит из useSidebarTaskSearch. Клик → доска проекта + открытая карточка.
// Находка в комментарии (match='comment') отличается иконкой и второй строкой с отрывком
// комментария, а ссылка ведёт прямо на него (?task=X#comment-Y).
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
        className="mbs-0.5 space-y-1"
        initial={animations ? 'hidden' : false}
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.04 } } }}
      >
        {visible.map((r) => {
          const inComment = r.match === 'comment';
          return (
            <motion.li
              key={r.taskId}
              variants={{ hidden: { opacity: 0, y: -4 }, show: { opacity: 1, y: 0 } }}
            >
              <NavLink
                to={
                  inComment && r.commentId
                    ? `/projects/${r.projectId}?task=${r.taskId}#comment-${r.commentId}`
                    : `/projects/${r.projectId}?task=${r.taskId}`
                }
                className="flex items-start gap-2 rounded-md px-2 py-2 transition-colors motion-safe:transition-[color,background-color,transform] hover:translate-x-0.5 hover:bg-hover"
              >
                {inComment ? (
                  <MessageSquare className="mbs-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <FileText className="mbs-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-snug">
                    {/* Заголовок задачи подсвечиваем только когда совпало именно в нём —
                        при находке в комментарии подсветка уезжает на вторую строку. */}
                    {inComment ? (
                      r.excerpt || '(без описания)'
                    ) : (
                      <Highlight text={r.excerpt || '(без описания)'} query={query} />
                    )}
                  </span>
                  {inComment && (
                    <span className="mbs-0.5 block truncate text-xs text-muted-foreground">
                      <span className="me-1 opacity-70">в комментарии:</span>
                      <Highlight text={r.commentExcerpt ?? ''} query={query} />
                    </span>
                  )}
                </span>
              </NavLink>
            </motion.li>
          );
        })}
      </motion.ul>

      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mbs-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <span className="grid size-5 shrink-0 place-items-center">
            <ChevronDown className={cn('size-4 motion-safe:transition-transform', expanded && 'rotate-180')} />
          </span>
          {expanded ? 'скрыть' : 'ещё'}
        </button>
      )}
    </div>
  );
}
