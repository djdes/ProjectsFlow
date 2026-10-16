import {
  Archive,
  ArrowRightLeft,
  AtSign,
  Check,
  CircleDot,
  CirclePlus,
  FolderPlus,
  Hourglass,
  KeyRound,
  LifeBuoy,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Pencil,
  RotateCcw,
  Server,
  ServerCrash,
  Trash2,
  Undo2,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActivityKind } from '@/domain/activity/ActivityFeedItem';
import type { NotificationPayload } from '@/domain/notifications/Notification';

// Тон метки = смысл (C4): queue — новое и адресованное мне, approval — ждёт утверждения,
// manual — ждёт ответа человека, done — закрыто, red — удаление и сбой, orange — упоминание,
// gray — справочное изменение.
export type FeedKindTone = 'queue' | 'approval' | 'manual' | 'done' | 'red' | 'orange' | 'gray';

export type FeedKind = {
  readonly label: string;
  readonly tone: FeedKindTone;
  readonly icon: LucideIcon;
};

const kind = (label: string, tone: FeedKindTone, icon: LucideIcon): FeedKind => ({ label, tone, icon });

const TASK_ACTION_KIND: Record<string, FeedKind> = {
  created: kind('Новая задача', 'queue', CirclePlus),
  commented: kind('Комментарий', 'gray', MessageSquare),
  approval_requested: kind('На утверждение', 'approval', Hourglass),
  approved: kind('Принята', 'done', Check),
  completed: kind('Завершена', 'done', Check),
  returned: kind('На доработку', 'manual', Undo2),
  withdrawn: kind('Отозвана', 'gray', Undo2),
  reopened: kind('Снова в работе', 'queue', RotateCcw),
  status_changed: kind('Статус', 'gray', CircleDot),
  assigned: kind('Назначение', 'queue', UserCheck),
  moved: kind('Перенос', 'gray', ArrowRightLeft),
  deleted: kind('Удалена', 'red', Trash2),
  restored: kind('Восстановлена', 'gray', RotateCcw),
  updated: kind('Изменение', 'gray', Pencil),
};

// Что это за уведомление — одной меткой в начале строки.
export function notificationKind(payload: NotificationPayload): FeedKind {
  switch (payload.type) {
    case 'task_changed':
      if (!payload.taskAvailable && payload.action !== 'deleted') return kind('Ушла от вас', 'gray', LogOut);
      return TASK_ACTION_KIND[payload.action] ?? TASK_ACTION_KIND['updated']!;
    case 'comment_mention':
      return kind('Упоминание', 'orange', AtSign);
    case 'chat_mention':
      return kind('Упоминание в чате', 'orange', MessagesSquare);
    case 'project_invite':
    case 'workspace_invite':
      return kind('Приглашение', 'queue', UserPlus);
    case 'join_request':
      return kind('Запрос доступа', 'manual', KeyRound);
    case 'task_delegation':
    case 'task_assignee_changed':
      return kind('Назначили вам', 'queue', UserCheck);
    case 'task_approval_requested':
      return kind('На утверждение', 'approval', Hourglass);
    case 'task_delegation_resolved':
      return kind('Назначение', 'gray', UserCheck);
    case 'task_assigned_to_project':
      return kind('Перенос', 'gray', ArrowRightLeft);
    case 'server_alert':
      if (payload.alertStatus === 'resolved') return kind('Сервер в норме', 'done', Server);
      return payload.severity === 'critical'
        ? kind('Сбой сервера', 'red', ServerCrash)
        : kind('Предупреждение', 'orange', Server);
    case 'daily_digest':
      return kind('Сводка', 'gray', Newspaper);
    case 'support_ticket':
      return kind('Поддержка', 'manual', LifeBuoy);
    default:
      // Тип, которого клиент ещё не знает (сервер новее), — без метки строка всё равно читается.
      return kind('Уведомление', 'gray', CircleDot);
  }
}

const ACTIVITY_KIND: Record<ActivityKind, FeedKind> = {
  task_created: TASK_ACTION_KIND['created']!,
  task_status_changed: TASK_ACTION_KIND['status_changed']!,
  task_updated: TASK_ACTION_KIND['updated']!,
  task_deleted: TASK_ACTION_KIND['deleted']!,
  task_commented: TASK_ACTION_KIND['commented']!,
  project_created: kind('Новый проект', 'queue', FolderPlus),
  project_updated: kind('Проект изменён', 'gray', Pencil),
  project_archived: kind('В архиве', 'gray', Archive),
  project_deleted: kind('Проект удалён', 'red', Trash2),
  member_added: kind('Новый участник', 'done', Users),
  member_removed: kind('Участник удалён', 'gray', Users),
  member_role_changed: kind('Роль изменена', 'gray', Users),
};

export function activityKind(k: ActivityKind): FeedKind {
  return ACTIVITY_KIND[k];
}

// Личные «Входящие» хранятся под служебным именем `inbox:<id>` — человеку это ничего не говорит.
export function feedProjectName(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  return value.startsWith('inbox:') ? 'Входящие' : value;
}

// Детали изменения задачи в уведомлении — одной короткой строкой и без дат: сроки видно в
// самой задаче, а в ленте они только раздували уведомление. Смена срока остаётся фактом
// («Изменён срок»), у новой задачи срок просто не показываем.
export function notificationDetail(action: string, detail: string | null | undefined): string {
  const lines = (detail ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^Срок до:/u.test(line)) return action === 'created' ? '' : 'Изменён срок';
      if (/^Дата начала:/u.test(line)) return action === 'created' ? '' : 'Изменена дата начала';
      return line;
    })
    .filter(Boolean);
  return lines[0] ?? '';
}

// Служебные имена авторов (агенты платформы) — по-человечески.
const ACTOR_LABEL: Record<string, string> = {
  'telegram-composer': 'Бот Telegram',
};

export function feedActorName(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  return ACTOR_LABEL[value] ?? value;
}

// Метка вида события: пастельная подложка тона, в тёмной теме — цветной текст.
export function KindChip({ kind: k, className }: { kind: FeedKind; className?: string }): React.ReactElement {
  const Icon = k.icon;
  return (
    <span
      className={cn(
        `pf-tone-${k.tone}`,
        'inline-flex h-[1.125rem] shrink-0 items-center gap-1 rounded px-1.5 text-2xs font-semibold leading-none',
        'bg-tone-bg text-tone-fg dark:text-tone',
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {k.label}
    </span>
  );
}
