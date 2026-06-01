import { useEffect, useState } from 'react';
import { Bell, ChevronDown, Users } from 'lucide-react';
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
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  projectId: string;
  // Автор комментария — исключаем из списка получателей (его всё равно отфильтрует сервер).
  excludeUserId?: string | null;
  // Уже загруженные участники (если есть) — чтобы не дёргать listMembers повторно.
  members?: readonly ProjectMember[];
  value: NotifyAudience;
  onChange: (next: NotifyAudience) => void;
  disabled?: boolean;
};

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

// Контрол адресации уведомления для композера: переключатель «Уведомить / Никто» +
// выпадающий список участников (мультивыбор; по умолчанию «Все»). Эмитит NotifyAudience.
export function NotifyAudienceControl({
  projectId,
  excludeUserId,
  members: membersProp,
  value,
  onChange,
  disabled,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [fetched, setFetched] = useState<ProjectMember[]>([]);

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

  const members = (membersProp ?? fetched).filter((m) => m.userId !== excludeUserId);

  const notifyOn = value.mode !== 'none';
  const selectedIds =
    value.mode === 'selected' ? new Set(value.userIds ?? []) : new Set<string>();

  const triggerLabel =
    value.mode === 'selected' ? `Выбрано: ${selectedIds.size}` : `Все (${members.length})`;

  const toggleMember = (userId: string): void => {
    const next = new Set(selectedIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    // Сняли всех — возвращаемся к «Все» (это интуитивнее, чем пустой selected).
    if (next.size === 0) onChange({ mode: 'all' });
    else onChange({ mode: 'selected', userIds: [...next] });
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <div className="inline-flex items-center rounded-md border bg-muted/40 p-0.5">
        <button
          type="button"
          aria-pressed={notifyOn}
          onClick={() => onChange({ mode: 'all' })}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors',
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
          aria-pressed={!notifyOn}
          onClick={() => onChange({ mode: 'none' })}
          className={cn(
            'rounded px-2 py-0.5 text-xs transition-colors',
            !notifyOn
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Никто
        </button>
      </div>

      {notifyOn && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              title="Кого уведомить"
            >
              <Users className="size-3" />
              {triggerLabel}
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
            <DropdownMenuCheckboxItem
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
                Все ({members.length})
              </span>
            </DropdownMenuCheckboxItem>
            {members.length > 0 && <DropdownMenuSeparator />}
            {members.map((m) => (
              <DropdownMenuCheckboxItem
                key={m.userId}
                checked={selectedIds.has(m.userId)}
                onSelect={(e) => {
                  e.preventDefault();
                  toggleMember(m.userId);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Avatar className="size-5">
                    {m.user.avatarUrl && <AvatarImage src={m.user.avatarUrl} alt="" />}
                    <AvatarFallback className="text-[9px]">
                      {initials(m.user.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{m.user.displayName}</span>
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
      )}
    </div>
  );
}
