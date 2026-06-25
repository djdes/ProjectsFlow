import { useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellOff,
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  MinusCircle,
  MoreHorizontal,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type {
  CommentNotification,
  CommentNotifications,
  TaskComment,
} from '@/domain/task/TaskComment';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  projectId: string;
  taskId: string;
  comment: TaskComment;
  /** Удаление комментария — пункт меню (перенесено из отдельной кнопки-корзины). */
  onDelete?: () => void;
};

// Человеко-читаемая причина пропуска/ошибки доставки.
const REASON_LABEL: Record<string, string> = {
  pref_off: 'отключены уведомления',
  no_email: 'нет e-mail',
  not_linked: 'Telegram не подключён',
  not_started: 'не нажал /start',
  dedup: 'недавно уже отправляли',
  rate_limited: 'лимит Telegram',
  forbidden: 'бот заблокирован',
};

function reasonText(reason: string | null): string {
  if (!reason) return '';
  return REASON_LABEL[reason] ?? reason;
}

function statusIcon(status: CommentNotification['status']): React.ReactElement {
  if (status === 'sent') return <Check className="size-3.5 text-emerald-600" />;
  if (status === 'failed') return <AlertCircle className="size-3.5 text-destructive" />;
  return <MinusCircle className="size-3.5 text-muted-foreground" />;
}

function channelIcon(channel: CommentNotification['channel']): React.ReactElement {
  return channel === 'email' ? (
    <Mail className="size-3.5 text-muted-foreground" />
  ) : (
    <Send className="size-3.5 text-muted-foreground" />
  );
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

// Группировка журнала по получателю (для строки «Имя · ✉ ✈»).
type Grouped = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly rows: CommentNotification[];
};

function groupByRecipient(recipients: readonly CommentNotification[]): Grouped[] {
  const map = new Map<string, Grouped>();
  for (const r of recipients) {
    const g = map.get(r.userId);
    if (g) {
      (g.rows as CommentNotification[]).push(r);
    } else {
      map.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        rows: [r],
      });
    }
  }
  return [...map.values()];
}

// Меню ⋮ у отправленного комментария: «Кто уведомлён» (журнал доставки), копирование
// ссылки на сам комментарий и текста.
export function CommentActionsMenu({ projectId, taskId, comment, onDelete }: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CommentNotifications | null>(null);

  const commentUrl = `${window.location.origin}/projects/${projectId}?task=${taskId}#comment-${comment.id}`;

  const copy = async (text: string, okMsg: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMsg);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const openWhoNotified = async (): Promise<void> => {
    setOpen(true);
    setLoading(true);
    setData(null);
    try {
      const res = await taskRepository.listCommentNotifications(projectId, taskId, comment.id);
      setData(res);
    } catch (e) {
      toast.error(`Не удалось загрузить: ${(e as Error).message}`);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const groups = data ? groupByRecipient(data.recipients) : [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Действия с комментарием"
            title="Ещё"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[230px]">
          <DropdownMenuItem onSelect={() => void openWhoNotified()}>
            <Bell className="size-3.5" />
            Кто уведомлён
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copy(commentUrl, 'Ссылка скопирована')}>
            <Link2 className="size-3.5" />
            Скопировать ссылку на комментарий
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copy(comment.body, 'Текст скопирован')}>
            <Copy className="size-3.5" />
            Скопировать текст
          </DropdownMenuItem>
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onDelete()}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Удалить
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Кто уведомлён</DialogTitle>
            <DialogDescription>
              Доставка уведомления об этом комментарии по каналам.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : data && data.notifyMode === 'none' ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <BellOff className="size-4" />
              Автор выбрал «Никто» — уведомления не отправлялись.
            </div>
          ) : groups.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Users className="size-4" />
              Получателей не было.
            </div>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto py-1">
              {groups.map((g) => (
                <li key={g.userId} className="flex items-start gap-2.5">
                  <Avatar className="size-7 shrink-0">
                    {g.avatarUrl && <AvatarImage src={g.avatarUrl} alt="" />}
                    <AvatarFallback className="text-[10px]">
                      {initials(g.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{g.displayName}</div>
                    <div className="mt-0.5 flex flex-col gap-0.5">
                      {g.rows.map((r) => (
                        <div
                          key={r.channel}
                          className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
                        >
                          {channelIcon(r.channel)}
                          <span>{r.channel === 'email' ? 'E-mail' : 'Telegram'}</span>
                          <span
                            className={cn(
                              'ml-auto inline-flex items-center gap-1',
                              r.status === 'sent' && 'text-emerald-600',
                              r.status === 'failed' && 'text-destructive',
                            )}
                          >
                            {statusIcon(r.status)}
                            {r.status === 'sent'
                              ? 'отправлено'
                              : r.status === 'failed'
                                ? `ошибка${r.reason ? ` · ${reasonText(r.reason)}` : ''}`
                                : `пропущено${r.reason ? ` · ${reasonText(r.reason)}` : ''}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
