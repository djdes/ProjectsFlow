import { useEffect, useMemo, useState } from 'react';
import { UserRoundCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import type { SharedMember } from '@/application/project/ProjectRepository';

type Props = {
  // null допустим только пока форма ждёт текущего пользователя. В меню пустого
  // значения нет: как только пользователь известен, он становится fallback.
  value: string | null;
  onChange: (userId: string) => void;
  disabled?: boolean;
  className?: string;
  // В именованном проекте доступны все его участники, включая viewer. Без
  // projectId выбираются пользователь и люди из общих проектов (Inbox).
  projectId?: string;
};

export function AssigneeSelect({
  value,
  onChange,
  disabled,
  className,
  projectId,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const { user } = useCurrentUser();
  const [loadedMembers, setLoadedMembers] = useState<SharedMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadedMembers(null);
    const request = projectId
      ? projectRepository.listMembers(projectId).then((list) =>
          list.map((member) => ({
            id: member.userId,
            displayName: member.user.displayName,
            email: member.user.email,
            avatarUrl: member.user.avatarUrl,
          })),
        )
      : projectRepository.listSharedMembers();
    request
      .then((members) => {
        if (!cancelled) setLoadedMembers(members);
      })
      .catch(() => {
        if (!cancelled) setLoadedMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId]);

  const members = useMemo(() => {
    const byId = new Map<string, SharedMember>();
    // Для Inbox caller всегда допустимый кандидат (владелец или shared-user). В
    // именованном проекте не добавляем admin-bypass: ответственным бывает только member.
    const currentUserIsEligible =
      !projectId || loadedMembers?.some((member) => member.id === user?.id) === true;
    if (user && currentUserIsEligible) {
      byId.set(user.id, {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
      });
    }
    for (const member of loadedMembers ?? []) byId.set(member.id, member);
    return [...byId.values()];
  }, [loadedMembers, projectId, user]);

  // У admin-bypass текущий пользователь может не входить в именованный проект. После
  // загрузки участников выбираем безопасный fallback вместо заведомо невалидного id.
  useEffect(() => {
    if (!projectId || loadedMembers === null || loadedMembers.length === 0) return;
    if (value && loadedMembers.some((member) => member.id === value)) return;
    const fallback = loadedMembers.find((member) => member.id === user?.id) ?? loadedMembers[0];
    if (fallback) onChange(fallback.id);
  }, [loadedMembers, onChange, projectId, user?.id, value]);

  const effectiveValue = value ?? user?.id ?? null;
  const selected = members.find((member) => member.id === effectiveValue) ?? null;
  const title = selected ? `Ответственный: ${selected.displayName}` : 'Выбрать ответственного';
  const inPropertyRow = (className ?? '').includes('justify-start');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {inPropertyRow ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn('text-foreground hover:text-foreground', className)}
            title={title}
            aria-label={title}
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <MemberAvatar member={selected} />
                <span className="truncate">{selected.displayName}</span>
              </span>
            ) : (
              'Загрузка…'
            )}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className={cn('shrink-0 text-foreground', className)}
            title={title}
            aria-label={title}
          >
            <UserRoundCheck className="size-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        {members.map((member) => (
          <DropdownMenuItem
            key={member.id}
            onClick={() => onChange(member.id)}
            className="gap-2"
          >
            <MemberAvatar member={member} />
            <span className={cn('min-w-0 truncate', member.id === effectiveValue && 'font-medium')}>
              {member.displayName}
            </span>
            {member.id === user?.id ? (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">вы</span>
            ) : (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {member.email}
              </span>
            )}
          </DropdownMenuItem>
        ))}
        {loadedMembers !== null && members.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Не удалось загрузить участников проекта.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MemberAvatar({ member }: { member: SharedMember }): React.ReactElement {
  return (
    <Avatar className="size-5 shrink-0">
      {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.displayName} />}
      <AvatarFallback className={cn('text-[9px]', avatarColor(member.displayName))}>
        {getInitials(member.displayName)}
      </AvatarFallback>
    </Avatar>
  );
}
