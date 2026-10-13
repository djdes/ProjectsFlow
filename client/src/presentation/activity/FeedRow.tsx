import { CalendarDays } from 'lucide-react';
import { formatExactDateTime } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/presentation/components/ai/relativeTime';

// Строка ленты (дизайн C4, плотная) — общая для событий проекта и уведомлений: аватар 20px;
// строка 1 — о чём (задача, проект) и когда, в одну линию с обрезкой; строка 2 — кто и что
// сделал, не длиннее двух линий. Полный текст — в подсказке. Ниже — только то, что резать
// нельзя: детали изменения из уведомления и кнопки «Принять».
export function FeedRow({
  avatar,
  subject,
  subjectTitle,
  meta,
  metaTitle,
  createdAt,
  badge,
  aside,
  children,
  className,
  onClick,
}: {
  avatar: React.ReactNode;
  subject: React.ReactNode;
  subjectTitle?: string;
  meta?: React.ReactNode;
  metaTitle?: string;
  createdAt: Date;
  // Метка между названием и временем («уточнение»).
  badge?: React.ReactNode;
  // Действие справа от времени (часы «История версий»).
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}): React.ReactElement {
  return (
    <TooltipProvider delayDuration={550} skipDelayDuration={120}>
      <li onClick={onClick} className={cn('group flex gap-2 rounded-md px-2 py-1 transition-colors', className)}>
        <span className="relative shrink-0">{avatar}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p
              title={subjectTitle}
              className="min-w-0 flex-1 select-text truncate text-ui font-medium leading-5 text-foreground"
            >
              {subject}
            </p>
            {badge}
            {/* Короткое время («5 мин»); наведение — точная дата до секунды (Notion-style). */}
            <Tooltip>
              <TooltipTrigger asChild>
                <time
                  dateTime={createdAt.toISOString()}
                  className="shrink-0 text-2xs tabular-nums text-muted-foreground hover:text-foreground"
                >
                  {formatRelativeTime(createdAt.getTime())}
                </time>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="flex items-center gap-1.5 border-border/60 shadow-lg">
                <CalendarDays className="size-3.5 text-muted-foreground" />
                {formatExactDateTime(createdAt)}
              </TooltipContent>
            </Tooltip>
            {aside}
          </div>
          {/* Строка «кто · что» в узкой боковой панели может не влезть («назначил(а) вас
              ответственным») — разрешаем вторую строку, а не режем смысл посередине. */}
          {meta && (
            <p
              title={metaTitle}
              className="line-clamp-2 select-text break-words text-meta leading-[1.125rem] text-muted-foreground"
            >
              {meta}
            </p>
          )}
          {children}
        </div>
      </li>
    </TooltipProvider>
  );
}
