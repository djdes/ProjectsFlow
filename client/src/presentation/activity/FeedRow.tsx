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
import { KindChip, type FeedKind } from './feedKind';

// Строка ленты (дизайн C4) — общая для событий проекта и уведомлений. Строка 1 — ЧТО это
// (метка вида: «Новая задача», «Упоминание»…), где (проект) и когда; строка 2 — о чём (задача,
// проект), в одну линию с обрезкой; строка 3 — кто и что сделал, не длиннее двух линий.
// Полный текст — в подсказке. Ниже — только то, что резать нельзя: детали изменения из
// уведомления и кнопки «Принять».
export function FeedRow({
  avatar,
  kind,
  context,
  unread = false,
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
  kind: FeedKind;
  // Где это случилось: проект, пространство.
  context?: string;
  unread?: boolean;
  subject: React.ReactNode;
  subjectTitle?: string;
  meta?: React.ReactNode;
  metaTitle?: string;
  createdAt: Date;
  // Метка справа от названия («уточнение»).
  badge?: React.ReactNode;
  // Действие справа от времени (часы «История версий»).
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}): React.ReactElement {
  return (
    <TooltipProvider delayDuration={550} skipDelayDuration={120}>
      <li onClick={onClick} className={cn('group flex gap-2.5 rounded-md px-2 py-1.5 transition-colors', className)}>
        <span className="shrink-0">{avatar}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <KindChip kind={kind} />
            {context && (
              <span title={context} className="min-w-0 truncate text-2xs text-muted-foreground">
                {context}
              </span>
            )}
            <span className="flex-1" />
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
            {/* Непрочитанное — точка в конце строки, а не поверх аватара. */}
            {unread && <span className="size-2 shrink-0 rounded-full bg-primary" role="img" aria-label="Не прочитано" />}
            {aside}
          </div>
          <div className="mbs-0.5 flex min-w-0 items-center gap-1.5">
            <p
              title={subjectTitle}
              className={cn(
                'min-w-0 flex-1 select-text truncate text-ui leading-5 text-foreground',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {subject}
            </p>
            {badge}
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

// Аватар строки ленты: тот же скруглённый квадрат, что везде в приложении, 24px — буквы
// инициалов не упираются в края.
export const FEED_AVATAR_CLASS = 'size-6 text-2xs';
