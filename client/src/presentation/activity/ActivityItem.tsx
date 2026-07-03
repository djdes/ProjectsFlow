import { useNavigate } from 'react-router-dom';
import {
  FolderPlus,
  MessageSquare,
  MoveRight,
  Pencil,
  SquarePen,
  Trash2,
  UserMinus,
  UserPlus,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import type { TaskStatus } from '@/domain/task/Task';
import type {
  ActivityEventItem,
  ActivityFieldChange,
  ActivityKind,
} from '@/domain/activity/ActivityFeedItem';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  task_created: SquarePen,
  task_status_changed: MoveRight,
  task_updated: Pencil,
  task_deleted: Trash2,
  task_commented: MessageSquare,
  project_created: FolderPlus,
  project_archived: FolderPlus,
  project_deleted: Trash2,
  member_added: UserPlus,
  member_removed: UserMinus,
  member_role_changed: UserCog,
};

function statusLabel(s: string | undefined): string {
  if (!s) return '';
  return STATUS_LABEL[s as TaskStatus] ?? s;
}

// Человекочитаемые подписи изменённых полей + значений (для Notion-style диффа).
const FIELD_LABEL: Record<string, string> = {
  description: 'Описание',
  deadline: 'Дедлайн',
  priority: 'Приоритет',
  ralphMode: 'Режим',
};
const PRIORITY_LABEL: Record<string, string> = {
  '1': 'Срочный',
  '2': 'Высокий',
  '3': 'Средний',
  '4': 'Низкий',
};
function humanizeValue(field: string, v: string | null): string {
  if (v == null || v === '') return '—';
  if (field === 'priority') return PRIORITY_LABEL[v] ?? v;
  return v.length > 180 ? `${v.slice(0, 180)}…` : v;
}

// Дифф изменённых полей: новое значение подсвечено синим (как в Notion), старое — зачёркнуто.
function ChangesDiff({ changes }: { changes: readonly ActivityFieldChange[] }): React.ReactElement {
  return (
    <div className="mt-1 space-y-1">
      {changes.map((c, i) => (
        <div key={`${c.field}-${i}`} className="text-xs leading-snug">
          <span className="text-muted-foreground">{FIELD_LABEL[c.field] ?? c.field}: </span>
          {c.field === 'description' ? (
            c.new ? (
              <span className="rounded bg-primary/10 px-1 text-foreground">{humanizeValue(c.field, c.new)}</span>
            ) : (
              <span className="text-muted-foreground">очищено</span>
            )
          ) : (
            <>
              {c.old != null && c.old !== '' && (
                <span className="text-muted-foreground line-through">{humanizeValue(c.field, c.old)}</span>
              )}{' '}
              <span aria-hidden className="text-muted-foreground">→</span>{' '}
              <span className="rounded bg-primary/10 px-1 font-medium text-primary">
                {humanizeValue(c.field, c.new)}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// Текст события. actor — имя актора (или «Кто-то»); target — имя затронутого участника.
function renderText(item: ActivityEventItem): React.ReactNode {
  const actor = item.actorDisplayName ?? 'Кто-то';
  const target = item.targetDisplayName ?? 'участника';
  const p = item.payload ?? {};
  const excerpt = p.taskExcerpt ? `«${p.taskExcerpt}»` : 'задачу';
  switch (item.kind) {
    case 'task_created':
      return (
        <>
          <b>{actor}</b> создал {excerpt}
        </>
      );
    case 'task_status_changed':
      return (
        <>
          <b>{actor}</b> перенёс {excerpt}: {statusLabel(p.oldStatus)} → <b>{statusLabel(p.newStatus)}</b>
        </>
      );
    case 'task_updated':
      return (
        <>
          <b>{actor}</b> изменил {excerpt}
        </>
      );
    case 'task_deleted':
      return (
        <>
          <b>{actor}</b> удалил {excerpt}
        </>
      );
    case 'task_commented':
      return (
        <>
          <b>{actor}</b> прокомментировал {excerpt}
          {p.commentExcerpt ? <span className="text-muted-foreground">: «{p.commentExcerpt}»</span> : null}
        </>
      );
    case 'project_created':
      return (
        <>
          <b>{actor}</b> создал проект {p.projectName ? <b>«{p.projectName}»</b> : ''}
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

// Куда ведёт клик: задача+коммент для task_commented, открытие карточки для созданной/
// перенесённой задачи, иначе — доска проекта (удалённую задачу не открываем).
function targetUrl(item: ActivityEventItem): string {
  const base = `/projects/${item.projectId}`;
  const taskId = item.payload?.taskId;
  if (!taskId) return base;
  if (item.kind === 'task_commented' && item.payload?.commentId)
    return `${base}?task=${taskId}#comment-${item.payload.commentId}`;
  if (item.kind === 'task_created' || item.kind === 'task_status_changed' || item.kind === 'task_updated')
    return `${base}?task=${taskId}`;
  return base;
}

// Строка амбиентного действия в ленте «Все». Клик ведёт к задаче/коммену/доске.
export function ActivityItem({ item }: { item: ActivityEventItem }): React.ReactElement {
  const navigate = useNavigate();
  const Icon = KIND_ICON[item.kind] ?? SquarePen;
  return (
    <li
      onClick={() => navigate(targetUrl(item))}
      className={cn(
        // overflow-hidden = содержит float иконки; текст обтекает иконку (начинается справа
        // от неё и продолжается под ней на всю ширину блока) — так шире и читабельнее.
        'group cursor-pointer overflow-hidden px-3 py-2 transition-colors hover:bg-muted/40',
      )}
    >
      <span className="float-left mr-2.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
        <Icon className="size-3.5" />
      </span>
      <p className="text-sm leading-snug">{renderText(item)}</p>
      {item.kind === 'task_updated' && item.payload?.changes?.length ? (
        <ChangesDiff changes={item.payload.changes} />
      ) : null}
      <p className="mt-0.5 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</p>
    </li>
  );
}
