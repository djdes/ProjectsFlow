import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { MembersHoverPanel } from './MembersHoverPanel';

// Сколько аватаров показываем в самом стеке (остальные — счётчиком «+N»).
const STACK = 4;

// Аватар-стек участников проекта с поповером-панелью при наведении (см. MembersHoverPanel).
// Поповер открывается по hover (задержка ~120мс) и по клику; курсор свободно переходит со
// стека на панель, не закрывая её (close-delay мостит зазор). Панель раскрывается плавно,
// выровнена по правому краю стека, клампится по вьюпорту (Radix Popover).
export function MemberAvatarStack({
  members,
  projectId,
  canInvite = false,
}: {
  members: ProjectMember[];
  // Проброс в панель: проект + право приглашать (editor+) включают форму приглашения.
  projectId?: string;
  canInvite?: boolean;
}): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const openTimer = React.useRef<number | undefined>(undefined);
  const closeTimer = React.useRef<number | undefined>(undefined);
  // «Закреплено»: пока внутри панели есть фокус (ввод email / открыт дропдаун «Из
  // знакомых»), hover-закрытие не срабатывает — иначе форма приглашения закрывалась бы
  // при уводе курсора. Снимается при закрытии поповера (outside-click / Esc).
  const pinnedRef = React.useRef(false);

  React.useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  React.useEffect(() => {
    if (!open) pinnedRef.current = false;
  }, [open]);

  if (members.length === 0) return null;

  const cancelClose = (): void => window.clearTimeout(closeTimer.current);
  const scheduleOpen = (): void => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 120);
  };
  const scheduleClose = (): void => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    // Не закрываем по hover, пока юзер работает с формой приглашения (фокус внутри).
    if (pinnedRef.current) return;
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          className="mr-1.5 flex items-center -space-x-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onClick={() => {
            window.clearTimeout(openTimer.current);
            setOpen((o) => !o);
          }}
          aria-label="Участники проекта"
          aria-expanded={open}
        >
          {members.slice(0, STACK).map((m) => (
            <Avatar key={m.userId} className="size-6 ring-2 ring-background">
              {m.user.avatarUrl ? (
                <AvatarImage src={m.user.avatarUrl} alt={m.user.displayName} />
              ) : null}
              <AvatarFallback className={cn('text-[9px]', avatarColor(m.user.displayName))}>
                {getInitials(m.user.displayName)}
              </AvatarFallback>
            </Avatar>
          ))}
          {members.length > STACK && (
            <span className="grid size-6 place-items-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
              +{members.length - STACK}
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
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onFocusCapture={() => {
          pinnedRef.current = true;
          cancelClose();
        }}
        className="w-80 p-0"
      >
        <MembersHoverPanel members={members} projectId={projectId} canInvite={canInvite} />
      </PopoverContent>
    </Popover>
  );
}
