import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { plainDescription, plainTaskTitle, stripInlineMarkdown } from '@/lib/taskTitleBody';
import {
  Tooltip,
  TooltipContent,
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
import { FeedRow } from './FeedRow';

// Полная очистка текста от markdown для минималистичной ленты (Notion): инлайн-разметка
// (** * ` ~~ == и т.п.) + ведущие маркеры заголовков/списков/цитат (### - * + > =) + схлоп пробелов.
function cleanText(s: string): string {
  return stripInlineMarkdown(s)
    .replace(/^\s*[-*+>~=#]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Имя задачи/проекта: заголовок без разметки и HTML (превью с сервера бывает обрезано
// посреди картинки-`<figure>` — plainTaskTitle это переживает). По ширине режет CSS.
function cleanName(raw: string | null | undefined): string {
  if (!raw) return '';
  const title = cleanText(plainTaskTitle(raw));
  return title.length > 200 ? `${title.slice(0, 200).trimEnd()}…` : title;
}

function statusLabel(s: string | undefined): string {
  if (!s) return '';
  return STATUS_LABEL[s as TaskStatus] ?? s;
}

// Подписи изменённых полей — строчными, они идут внутри строки: «срок: 13 окт.».
const FIELD_LABEL: Record<string, string> = {
  description: 'описание',
  status: 'статус',
  deadline: 'срок',
  priority: 'приоритет',
  assigneeUserId: 'ответственный',
  assignee: 'ответственный',
  ralphMode: 'режим',
  name: 'название',
  cover: 'обложка',
  attachments: 'файлы',
  startDate: 'начало',
};
const PRIORITY_LABEL: Record<string, string> = {
  '1': 'Срочный',
  '2': 'Высокий',
  '3': 'Средний',
  '4': 'Низкий',
};
const DATE_FIELDS: ReadonlySet<string> = new Set(['deadline', 'startDate']);

// «2026-10-13» → «13 окт.» (год — только если не текущий).
function formatDay(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

function humanizeValue(field: string, v: string | null): string {
  if (field === 'cover') return v ? 'обновлена' : 'убрана';
  if (v == null || v === '') return '—';
  if (field === 'status') return statusLabel(v);
  if (field === 'priority') return PRIORITY_LABEL[v] ?? v;
  if (DATE_FIELDS.has(field)) return formatDay(v);
  // Текстовые поля — плоский текст и короткая обрезка (Notion). Описание хранит и HTML
  // редактора (картинки — `<figure data-figure-image>`): его чистит plainDescription.
  const clean = field === 'description' ? plainDescription(v) : cleanText(v);
  if (!clean) return '—';
  return clean.length > 80 ? `${clean.slice(0, 80).trimEnd()}…` : clean;
}

// Одно изменение в строке «кто · что»: «Вручную → Готово», «срок: 13 окт.», «приоритет:
// Средний → Высокий». Статус без подписи — стрелка между статусами говорит сама за себя.
// Описание в строку не влезает — называем поле, текст виден в задаче (клик подсветит поле).
type ChangeParts = { readonly label: string; readonly old: string | null; readonly next: string };

function changeParts(change: ActivityFieldChange): ChangeParts {
  if (change.field === 'cover') return { label: '', old: null, next: `обложка ${humanizeValue('cover', change.new)}` };
  if (change.field === 'description') {
    return { label: '', old: null, next: change.new ? 'описание' : 'описание очищено' };
  }
  const old = humanizeValue(change.field, change.old);
  return {
    label: change.field === 'status' ? '' : `${FIELD_LABEL[change.field] ?? change.field}: `,
    old: old === '—' ? null : old,
    next: humanizeValue(change.field, change.new),
  };
}

function changeText(change: ActivityFieldChange): string {
  const { label, old, next } = changeParts(change);
  return `${label}${old ? `${old} → ` : ''}${next}`;
}

function ChangeInline({ change }: { change: ActivityFieldChange }): React.ReactElement {
  const { label, old, next } = changeParts(change);
  const plain = change.field === 'description' || change.field === 'cover';
  return (
    <>
      {label}
      {old && (
        <>
          <span className="line-through decoration-muted-foreground/50">{old}</span>
          {' → '}
        </>
      )}
      <span className={plain ? undefined : 'font-medium text-foreground'}>{next}</span>
    </>
  );
}

// Кликабельный фрагмент строки (название задачи / изменения). stopPropagation — чтобы клик
// не «проваливался» дальше по строке.
function ActLink({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
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
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
      className={className ?? 'cursor-pointer rounded decoration-muted-foreground/40 underline-offset-2 hover:underline'}
    >
      {children}
    </span>
  );
}

// События про задачу: строка 1 — её название (у событий проекта — имя проекта).
const TASK_EVENT_KINDS: ReadonlySet<ActivityKind> = new Set([
  'task_created',
  'task_status_changed',
  'task_updated',
  'task_deleted',
  'task_commented',
]);

// События про участника: строка 1 — его имя.
const MEMBER_EVENT_KINDS: ReadonlySet<ActivityKind> = new Set([
  'member_added',
  'member_removed',
  'member_role_changed',
]);

// Задачные события, у которых есть история версий (кнопка-часы «Посмотреть версию»).
const VERSIONED_KINDS: ReadonlySet<ActivityKind> = new Set([
  'task_created',
  'task_updated',
  'task_status_changed',
]);

// Строка 2 события без изменений и комментария: «Олег Боев создал задачу».
const KIND_VERB: Partial<Record<ActivityKind, string>> = {
  task_created: 'создал задачу',
  task_status_changed: 'изменил статус',
  task_updated: 'изменил задачу',
  task_deleted: 'удалил задачу',
  task_commented: 'прокомментировал',
  project_created: 'создал проект',
  project_updated: 'изменил проект',
};

// Строка ленты событий (дизайн C4, плотная): строка 1 — задача или проект и время, строка 2 —
// «кто · что изменилось». Клик по названию открывает задачу, по изменениям — задачу с
// подсветкой поля. onOpenVersions — если задан и у задачи есть версии, справа от времени
// появляются часы «История версий».
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
  const payload = item.payload;
  // Кнопку истории версий показываем ТОЛЬКО когда у задачи реально есть версии (hasVersions
  // с сервера) — иначе часы-иконка вела бы в пустое окно «Версий пока нет».
  const versionTaskId =
    onOpenVersions && VERSIONED_KINDS.has(item.kind) && item.hasVersions && !item.taskDeleted
      ? (payload?.taskId ?? null)
      : null;
  const taskId = item.taskDeleted || item.kind === 'task_deleted' ? null : (payload?.taskId ?? null);
  const openTask = (field?: string): void => {
    if (!taskId) return;
    navigate(`/projects/${item.projectId}/tasks/${taskId}${field ? `?hl=${encodeURIComponent(field)}` : ''}`);
  };
  const openProject = (): void => {
    navigate(`/projects/${item.projectId}`);
  };

  // Строка 1: о чём событие — задача, участник или проект. Задача в корзине — зачёркнутое
  // название без ссылки: ссылка вела бы в 404, а зачёркивание объясняет, почему клика нет.
  const isTaskEvent = TASK_EVENT_KINDS.has(item.kind);
  const isMemberEvent = MEMBER_EVENT_KINDS.has(item.kind);
  const name = isTaskEvent
    ? cleanName(payload?.taskExcerpt) || 'Задача'
    : isMemberEvent
      ? (item.targetDisplayName ?? (item.kind === 'member_added' ? actor : 'Участник'))
      : cleanName(payload?.projectName) || 'Проект';
  const subject = isMemberEvent ? (
    name
  ) : !isTaskEvent ? (
    <ActLink onClick={openProject}>{name}</ActLink>
  ) : taskId ? (
    <ActLink onClick={() => openTask()}>{name}</ActLink>
  ) : (
    <span className="text-muted-foreground line-through decoration-muted-foreground/50">{name}</span>
  );

  const changes: readonly ActivityFieldChange[] =
    item.kind === 'task_status_changed'
      ? payload?.newStatus
        ? [{ field: 'status', old: payload.oldStatus ?? null, new: payload.newStatus }]
        : []
      : (item.kind === 'task_updated' || item.kind === 'project_updated') && payload?.changes?.length
        ? payload.changes
        : [];
  const comment =
    item.kind === 'task_commented' && payload?.commentExcerpt ? plainDescription(payload.commentExcerpt) : '';

  // Строка 2: кто и что сделал.
  const who = <span className="text-foreground">{actor}</span>;
  let meta: React.ReactNode;
  let metaTitle: string | undefined;
  if (changes.length > 0) {
    const inline = changes.map((change, i) => (
      <span key={`${change.field}-${i}`}>
        {i > 0 && ' · '}
        <ChangeInline change={change} />
      </span>
    ));
    meta = (
      <>
        {who}
        {' · '}
        {taskId || !isTaskEvent ? (
          <ActLink
            onClick={() => (taskId ? openTask(changes[0]?.field) : openProject())}
            className="cursor-pointer hover:text-foreground"
          >
            {inline}
          </ActLink>
        ) : (
          inline
        )}
      </>
    );
    metaTitle = `${actor} · ${changes.map(changeText).join(' · ')}`;
  } else if (comment) {
    meta = (
      <>
        {who}: «{comment}»
      </>
    );
    metaTitle = `${actor}: «${comment}»`;
  } else {
    const verb = KIND_VERB[item.kind];
    meta =
      item.kind === 'member_added' ? (
        'присоединился к проекту'
      ) : item.kind === 'member_removed' ? (
        <>
          {who} удалил из проекта
        </>
      ) : item.kind === 'member_role_changed' ? (
        <>
          {who} сменил роль
        </>
      ) : (
        <>
          {who}
          {verb ? ` ${verb}` : ''}
        </>
      );
  }

  return (
    <FeedRow
      className="hover:bg-hover"
      createdAt={item.createdAt}
      subject={subject}
      subjectTitle={item.taskDeleted && isTaskEvent ? `${name} (задача удалена)` : name}
      meta={meta}
      metaTitle={metaTitle}
      avatar={
        // Аватар автора — hover: карточка с именем и текущим местным временем (как в Notion).
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <UserAvatar displayName={actor} avatarUrl={item.actorAvatarUrl} className="size-5 rounded-full text-[9px]" />
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
            <span className="pe-2 text-start">
              <span className="block text-sm font-semibold text-foreground">
                {actor}
                {isYou && <span className="font-normal text-muted-foreground"> (вы)</span>}
              </span>
              <span className="mbs-0.5 block text-xs text-muted-foreground">
                {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — местное время
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      }
      aside={
        // История версий — по наведению/фокусу (на тач-экранах — всегда).
        versionTaskId ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenVersions?.(versionTaskId);
                }}
                aria-label="История версий"
                className="-my-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <Clock className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="border-transparent bg-foreground text-background">
              История версий
            </TooltipContent>
          </Tooltip>
        ) : onOpenVersions ? (
          // Место под часы держим и у событий без версий — время стоит одной колонкой.
          <span aria-hidden className="-my-0.5 size-6 shrink-0" />
        ) : undefined
      }
    />
  );
}
