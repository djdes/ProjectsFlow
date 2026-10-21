import { useEffect, useState } from 'react';
import { Bell, BellOff, ChevronDown, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import type { NotifyAudience } from '@/domain/task/TaskComment';
import type { TaskAssignee } from '@/domain/task/TaskAssignee';
import { useContainer } from '@/infrastructure/di/container';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';

type Props = {
  projectId: string;
  // Автор комментария — исключаем из списка получателей (его всё равно отфильтрует сервер).
  excludeUserId?: string | null;
  // Уже загруженные участники (если есть) — чтобы не дёргать listMembers повторно.
  members?: readonly ProjectMember[];
  assignee?: TaskAssignee | null;
  defaultAudience?: NotifyAudience;
  value: NotifyAudience;
  onChange: (next: NotifyAudience) => void;
  disabled?: boolean;
};

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

// Контрол адресации уведомления для композера: переключатель «Уведомить / Никто» +
// выпадающий список участников (мультивыбор). Эмитит NotifyAudience.
//
// На телефоне — одна кнопка «🔔 Денис Волков ▾» (или «🔕 Никто»), а «Никого не уведомлять»
// живёт первым пунктом её меню (меню там открывается нижним листом). Переключатель и
// выпадашка рядом не помещались: в ряду со скрепкой и отправкой на 320px от имени
// получателя оставалось многоточие, а на 390px — «Денис В…».
export function NotifyAudienceControl({
  projectId,
  excludeUserId,
  members: membersProp,
  assignee,
  defaultAudience = { mode: 'all' },
  value,
  onChange,
  disabled,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [fetched, setFetched] = useState<ProjectMember[]>([]);
  const compact = useMediaQuery('(max-width: 639px)');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Если участники переданы пропом — не дёргаем сеть.
    if (membersProp) return;
    let alive = true;
    projectRepository
      .listMembers(projectId)
      .then((list) => {
        if (alive) setFetched(list);
      })
      .catch(() => {
        if (alive) setFetched([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId, membersProp, projectRepository]);

  const members = (membersProp ?? fetched)
    .filter((m) => m.userId !== excludeUserId)
    .map((m) => ({ userId: m.userId, displayName: m.user.displayName, avatarUrl: m.user.avatarUrl }));
  if (assignee && assignee.userId !== excludeUserId && !members.some((m) => m.userId === assignee.userId)) {
    members.push(assignee);
  }

  const notifyOn = value.mode !== 'none';
  const selectedIds =
    value.mode === 'selected' ? new Set(value.userIds ?? []) : new Set<string>();

  // Один получатель — показываем имя: дефолт «только ответственный» должен читаться как
  // «уведомлю Ярослава», а не как безликое «Выбрано: 1».
  const soleSelected =
    selectedIds.size === 1 ? members.find((m) => selectedIds.has(m.userId)) : undefined;
  const triggerLabel =
    value.mode !== 'selected'
      ? 'По задаче'
      : (soleSelected?.displayName ?? `Выбрано: ${selectedIds.size}`);

  const toggleMember = (userId: string): void => {
    const next = new Set(selectedIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    // Removing the last recipient means no notifications.
    if (next.size === 0) onChange({ mode: 'none' });
    else onChange({ mode: 'selected', userIds: [...next] });
  };

  return (
    <div
      className={cn(
        'inline-flex min-w-0 items-center gap-1',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {!compact && (
      <div className="inline-flex shrink-0 items-center rounded-lg bg-muted p-0.5">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={notifyOn}
          // Уже уведомляем — клик ничего не меняет. Иначе повторный клик по активной кнопке
          // втихую расширял бы адресата с «только ответственный» до всех участников.
          onClick={() => {
            if (notifyOn) return;
            if (defaultAudience.mode === 'none') setOpen(true);
            else onChange(defaultAudience);
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
            notifyOn
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Bell className="size-3" />
          Уведомить
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!notifyOn}
          onClick={() => onChange({ mode: 'none' })}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs transition-colors',
            !notifyOn
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Никто
        </button>
      </div>
      )}

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          {/* Имя получателя режется «…», а не переносится: на телефоне «Денис Волков»
              ломалось на две строки и раздувало нижний ряд композера. */}
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            disabled={disabled}
            title="Кого уведомить"
            aria-label={compact ? `Кого уведомить: ${notifyOn ? triggerLabel : 'никого'}` : undefined}
          >
            {!compact ? (
              <Users className="size-3 shrink-0" />
            ) : notifyOn ? (
              <Bell className="size-3.5 shrink-0" />
            ) : (
              <BellOff className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{notifyOn ? triggerLabel : compact ? 'Никто' : 'Выбрать'}</span>
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          {compact && (
            <>
              <DropdownMenuCheckboxItem
                disabled={disabled}
                checked={!notifyOn}
                onSelect={() => onChange({ mode: 'none' })}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-muted">
                    <BellOff className="size-3" />
                  </span>
                  Никого не уведомлять
                </span>
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuCheckboxItem
            disabled={disabled}
            checked={value.mode === 'all'}
            onSelect={(e) => {
              e.preventDefault();
              onChange({ mode: 'all' });
            }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-muted">
                <Users className="size-3" />
              </span>
              Участники задачи
            </span>
          </DropdownMenuCheckboxItem>
          {members.length > 0 && <DropdownMenuSeparator />}
          {members.map((m) => (
            <DropdownMenuCheckboxItem
              disabled={disabled}
              key={m.userId}
              checked={selectedIds.has(m.userId)}
              onSelect={(e) => {
                e.preventDefault();
                toggleMember(m.userId);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <Avatar className="size-5">
                  {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[9px]">
                    {initials(m.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{m.displayName}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          {members.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              Только вы — уведомлять некого
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
