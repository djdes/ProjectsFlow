import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Clock } from 'lucide-react';
import { relativeTime } from '@/lib/relativeTime';
import { formatExactDateTime } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { parseTitleHeading, splitTitleBody, stripInlineMarkdown } from '@/lib/taskTitleBody';

// Полная очистка текста от markdown для минималистичной ленты (Notion): инлайн-разметка
// (** * ` ~~ == и т.п.) + ведущие маркеры заголовков/списков/цитат (### - * + > =) + схлоп пробелов.
function cleanText(s: string): string {
  return stripInlineMarkdown(s)
    .replace(/^\s*[-*+>~=#]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Чистое короткое имя (заголовок = первая строка, без markdown-заголовка ### и разметки), обрезка.
function cleanName(raw: string | null | undefined, max = 40): string {
  if (!raw) return '';
  const title = cleanText(parseTitleHeading(splitTitleBody(raw).title).text);
  return title.length > max ? `${title.slice(0, max).trimEnd()}…` : title;
}
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import type { TaskStatus } from '@/domain/task/Task';
import type {
  ActivityEventItem,
  ActivityFieldChange,
  ActivityKind,
} from '@/domain/activity/ActivityFeedItem';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';

function statusLabel(s: string | undefined): string {
  if (!s) return '';
  return STATUS_LABEL[s as TaskStatus] ?? s;
}

// Человекочитаемые подписи изменённых полей + значений (для Notion-style диффа).
const FIELD_LABEL: Record<string, string> = {
  description: 'Описание',
  status: 'Статус',
  deadline: 'Дедлайн',
  priority: 'Приоритет',
  assigneeUserId: 'Ответственный',
  assignee: 'Ответственный',
  ralphMode: 'Режим',
  name: 'Название',
  cover: 'Обложка',
  attachments: 'Файлы',
  startDate: 'Дата начала',
};
const PRIORITY_LABEL: Record<string, string> = {
  '1': 'Срочный',
  '2': 'Высокий',
  '3': 'Средний',
  '4': 'Низкий',
};
function humanizeValue(field: string, v: string | null): string {
  if (field === 'cover') return v ? 'обновлена' : 'убрана';
  if (v == null || v === '') return '—';
  if (field === 'status') return statusLabel(v);
  if (field === 'priority') return PRIORITY_LABEL[v] ?? v;
  // Текстовые поля (описание/название) — полная чистка markdown и короткая обрезка (Notion).
  const clean = cleanText(v);
  return clean.length > 80 ? `${clean.slice(0, 80).trimEnd()}…` : clean;
}

// Дифф изменённых полей: новое значение подсвечено синим (как в Notion), старое — зачёркнуто.
// onOpen — клик по блоку открывает задачу/страницу с подсветкой изменённого поля.
function ChangesDiff({
  changes,
  onOpen,
}: {
  changes: readonly ActivityFieldChange[];
  onOpen?: () => void;
}): React.ReactElement {
  return (
    <div
      onClick={onOpen ? () => onOpen() : undefined}
      className={cn(
        'mt-2.5 overflow-hidden rounded-xl border border-border/70 bg-muted/20 transition-colors',
        onOpen && 'cursor-pointer hover:border-border hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpen();
      } : undefined}
    >
      {changes.map((c, i) => (
        <div
          key={`${c.field}-${i}`}
          className="grid gap-1.5 border-b border-border/50 px-3 py-2.5 text-xs last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start"
        >
          <span className="font-medium text-muted-foreground">{FIELD_LABEL[c.field] ?? c.field}</span>
          {c.field === 'description' ? (
            <span className="grid min-w-0 gap-1.5">
              {c.old ? (
                <span className="min-w-0 rounded-md bg-background/80 px-2 py-1.5 text-muted-foreground line-through decoration-muted-foreground/50">
                  {humanizeValue(c.field, c.old)}
                </span>
              ) : null}
              <span className="min-w-0 rounded-md bg-primary/10 px-2 py-1.5 font-medium text-foreground">
                {c.new ? humanizeValue(c.field, c.new) : 'Очищено'}
              </span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="max-w-full truncate rounded-md bg-background/80 px-2 py-1 text-muted-foreground line-through decoration-muted-foreground/50">
                {humanizeValue(c.field, c.old)}
              </span>
              <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
              <span className="max-w-full truncate rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">
                {humanizeValue(c.field, c.new)}
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Кликабельный фрагмент текста события (название задачи / имя проекта). stopPropagation —
// чтобы клик по ссылке не «проваливался» дальше по строке.
function ActLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          onClick();
        }
      }}
      className="cursor-pointer rounded font-semibold text-foreground decoration-muted-foreground/40 underline-offset-2 hover:underline"
    >
      {children}
    </span>
  );
}

type NavHandlers = { openTask: () => void; openProject: () => void };

// Текст события. Название задачи и имя проекта — отдельные кликабельные ссылки; сам глагол
// («изменил», «перенёс») и имя автора — обычный выделяемый/копируемый текст.
function renderText(item: ActivityEventItem, nav: NavHandlers): React.ReactNode {
  const actor = item.actorDisplayName ?? 'Кто-то';
  const target = item.targetDisplayName ?? 'участника';
  const p = item.payload ?? {};
  const taskName = cleanName(p.taskExcerpt);
  const taskLabel = taskName ? `«${taskName}»` : 'задачу';
  // Задача в корзине: текст события сохраняем («что было»), но ссылку убираем — она вела бы
  // в 404. Помечаем явно, чтобы отсутствие клика не выглядело поломкой.
  const taskLink = item.taskDeleted ? (
    <span className="text-muted-foreground">
      {taskLabel} <span className="text-xs">(задача удалена)</span>
    </span>
  ) : (
    <ActLink onClick={nav.openTask}>{taskLabel}</ActLink>
  );
  const projectName = cleanName(p.projectName, 32);
  const projectLink = projectName ? <ActLink onClick={nav.openProject}>«{projectName}»</ActLink> : null;
  switch (item.kind) {
    case 'task_created':
      return (
        <>
          <b>{actor}</b> создал {taskLink}
        </>
      );
    case 'task_status_changed':
      return (
        <>
          <b>{actor}</b> изменил статус {taskLink}
        </>
      );
    case 'task_updated':
      return (
        <>
          <b>{actor}</b> изменил {taskLink}
        </>
      );
    case 'task_deleted':
      return (
        <>
          <b>{actor}</b> удалил {taskName ? `«${taskName}»` : 'задачу'}
        </>
      );
    case 'task_commented':
      return (
        <>
          <b>{actor}</b> прокомментировал {taskLink}
          {p.commentExcerpt ? (
            <span className="text-muted-foreground">: «{cleanName(p.commentExcerpt, 48)}»</span>
          ) : null}
        </>
      );
    case 'project_created':
      return (
        <>
          <b>{actor}</b> создал проект {projectLink}
        </>
      );
    case 'project_updated':
      return (
        <>
          <b>{actor}</b> изменил проект {projectLink}
        </>
      );
    case 'member_added':
      return (
        <>
          <b>{item.targetDisplayName ?? actor}</b> присоединился к проекту
        </>
      );
    case 'member_removed':
      return (
        <>
          <b>{actor}</b> удалил {target} из проекта
        </>
      );
    case 'member_role_changed':
      return (
        <>
          <b>{actor}</b> сменил роль {target}
        </>
      );
    default:
      return <b>{actor}</b>;
  }
}

// Задачные события, у которых есть история версий (кнопка-часы «Посмотреть версию»).
const TASK_KINDS: ReadonlySet<ActivityKind> = new Set([
  'task_created',
  'task_updated',
  'task_status_changed',
]);

// Строка амбиентного действия в ленте «Все». Клик ведёт к задаче/коммену/доске.
// onOpenVersions — если задан и событие задачное, справа-сверху появляется часы-иконка,
// открывающая окно версий этой задачи.
export function ActivityItem({
  item,
  onOpenVersions,
}: {
  item: ActivityEventItem;
  onOpenVersions?: (taskId: string) => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const actor = item.actorDisplayName ?? 'Кто-то';
  const isYou = !!user?.id && item.actorUserId === user.id;
  // Кнопку истории версий показываем ТОЛЬКО когда у задачи реально есть версии (hasVersions
  // с сервера) — иначе часы-иконка вела бы в пустое окно «Версий пока нет».
  const versionTaskId =
    onOpenVersions && TASK_KINDS.has(item.kind) && item.hasVersions && !item.taskDeleted
      ? (item.payload?.taskId ?? null)
      : null;
  const taskId = item.taskDeleted ? null : (item.payload?.taskId ?? null);
  // Название задачи / блок изменения ведут на страницу задачи (при hl= — с подсветкой поля);
  // имя проекта — на доску проекта. Сам глагол/имя автора остаются обычным текстом (выделяется).
  const openTask = (field?: string): void => {
    if (!taskId) return;
    navigate(`/projects/${item.projectId}/tasks/${taskId}${field ? `?hl=${encodeURIComponent(field)}` : ''}`);
  };
  const openProject = (): void => {
    navigate(`/projects/${item.projectId}`);
  };
  return (
    <TooltipProvider delayDuration={550} skipDelayDuration={120}>
      <li className="group relative flex gap-3.5 px-5 py-3.5 transition-colors before:absolute before:bottom-0 before:left-[33px] before:top-0 before:w-px before:bg-border/70 first:before:top-7 last:before:bottom-7 hover:bg-muted/30">
        {/* Аватар автора — hover: карточка с именем и текущим местным временем (как в Notion). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="relative z-10 mt-0.5 shrink-0 rounded-full bg-background ring-4 ring-background">
              <UserAvatar
                displayName={actor}
                avatarUrl={item.actorAvatarUrl}
                className="size-7 rounded-full text-[11px]"
              />
            </span>
          </TooltipTrigger>
          {/* Появляется чуть ВЫШЕ и ЛЕВЕЕ наведённого аватара (Notion-style): side=top align=end. */}
          <TooltipContent
            side="top"
            align="end"
            sideOffset={8}
            className="flex items-center gap-3 rounded-xl border-border/60 p-3 shadow-lg"
          >
            <UserAvatar displayName={actor} avatarUrl={item.actorAvatarUrl} className="size-11 rounded-full text-base" />
            <span className="pr-2 text-left">
              <span className="block text-sm font-semibold text-foreground">
                {actor}
                {isYou && <span className="font-normal text-muted-foreground"> (вы)</span>}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — местное время
              </span>
            </span>
          </TooltipContent>
        </Tooltip>

        <div className="min-w-0 flex-1">
          <div className="flex min-h-8 items-start gap-2">
            <p className="min-w-0 flex-1 select-text pt-0.5 text-sm leading-relaxed">
              {renderText(item, { openTask: () => openTask(), openProject })}
            </p>
            {/* Правый слот ФИКСИРОВАННОЙ ширины под кнопку версии — резервируется всегда, чтобы
                текст НИКОГДА не доходил до правого края (там кнопка), одинаково у всех сообщений
                (как в Notion). Кнопка появляется, если у задачи есть версии; иначе слот пустой. */}
            <div className="flex w-9 shrink-0 justify-end">
              {versionTaskId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenVersions?.(versionTaskId);
                      }}
                      aria-label="История версий"
                      className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Clock className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="border-transparent bg-neutral-900 text-white">
                    История версий
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          {/* Время — серым, чуть ниже; hover: точная дата/время до секунды (Notion-style). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mt-0.5 inline-block w-fit text-xs text-muted-foreground hover:text-foreground">
                {relativeTime(item.createdAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="flex items-center gap-1.5 border-border/60 shadow-lg">
              <CalendarDays className="size-3.5 text-muted-foreground" />
              {formatExactDateTime(item.createdAt)}
            </TooltipContent>
          </Tooltip>
          {(item.kind === 'task_updated' || item.kind === 'project_updated') &&
          item.payload?.changes?.length ? (
            <ChangesDiff
              changes={item.payload.changes}
              // Клик по блоку изменения → задача с подсветкой изменённого поля (или проект).
              onOpen={() =>
                taskId ? openTask(item.payload?.changes?.[0]?.field) : openProject()
              }
            />
          ) : null}
          {item.kind === 'task_status_changed' ? (
            <ChangesDiff
              changes={[
                {
                  field: 'status',
                  old: item.payload?.oldStatus ?? null,
                  new: item.payload?.newStatus ?? null,
                },
              ]}
              onOpen={() => openTask('status')}
            />
          ) : null}
        </div>
      </li>
    </TooltipProvider>
  );
}
