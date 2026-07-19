import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { MembersHoverPanel } from './MembersHoverPanel';

// Максимум кружков в стеке — места в шапках мало, держим компактно.
// Если участников больше — последний кружок становится счётчиком «+N»,
// поэтому аватаров показываем на один меньше.
const MAX_CIRCLES = 3;

// Аватар-стек участников проекта с поповером-панелью при наведении (см. MembersHoverPanel).
// Поповер открывается по hover (задержка ~120мс) и по клику; курсор свободно переходит со
// стека на панель, не закрывая её (close-delay мостит зазор). Панель раскрывается плавно,
// выровнена по правому краю стека, клампится по вьюпорту (Radix Popover).
export function MemberAvatarStack({
  members,
  canInvite = false,
  ownerId,
}: {
  members: ProjectMember[];
  // Право приглашать (editor+) включает форму приглашения в пространство в панели.
  canInvite?: boolean;
  // Создатель проекта (projects.owner_id) — панель помечает его «Создал».
  ownerId?: string;
}): React.ReactElement | null {
  // Панель участников открывается по КЛИКУ (не по наведению) — по требованию.
  const [open, setOpen] = React.useState(false);

  if (members.length === 0) return null;

  // Всего кружков не больше MAX_CIRCLES. Если все помещаются — показываем всех без
  // счётчика; если нет — последний кружок занимает «+N», значит аватаров на один меньше.
  const shown = members.length <= MAX_CIRCLES ? members.length : MAX_CIRCLES - 1;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          className="mr-1.5 flex items-center -space-x-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          onClick={() => setOpen((o) => !o)}
          aria-label="Участники проекта"
          aria-expanded={open}
        >
          {members.slice(0, shown).map((m) => (
            <Avatar key={m.userId} className="size-6 ring-2 ring-background">
              {m.user.avatarUrl ? (
                <AvatarImage src={m.user.avatarUrl} alt={m.user.displayName} />
              ) : null}
              <AvatarFallback className={cn('text-[9px]', avatarColor(m.user.displayName))}>
                {getInitials(m.user.displayName)}
              </AvatarFallback>
            </Avatar>
          ))}
          {members.length > shown && (
            <span className="grid size-6 place-items-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
              +{members.length - shown}
            </span>
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-80 p-0"
      >
        <MembersHoverPanel members={members} canInvite={canInvite} ownerId={ownerId} />
      </PopoverContent>
    </Popover>
  );
}
