import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, UserRoundCheck } from 'lucide-react';
import { PROPERTY_CARET_CLASS } from './PropertyRow';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  onOpenChange?: (open: boolean) => void;
};

export function AssigneeSelect({
  value,
  onChange,
  disabled,
  className,
  projectId,
  onOpenChange,
}: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const { user } = useCurrentUser();
  const [memberResult, setMemberResult] = useState<{
    projectId: string | undefined;
    members: SharedMember[] | null;
    failed: boolean;
  } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadedMembers = memberResult?.projectId === projectId ? memberResult?.members ?? null : null;
  const loadFailed = memberResult?.projectId === projectId && memberResult?.failed === true;

  useEffect(() => {
    let cancelled = false;
    setMemberResult(null);
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
        if (!cancelled) setMemberResult({ projectId, members, failed: false });
      })
      .catch(() => {
        if (!cancelled) setMemberResult({ projectId, members: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId, loadAttempt]);

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

  // Preserve the selection when switching projects if it is still eligible.
  // Inbox also needs validation when returning from a project with different members.
  useEffect(() => {
    if (loadedMembers === null || members.length === 0) return;
    if (value && members.some((member) => member.id === value)) return;
    const fallback = members.find((member) => member.id === user?.id) ?? members[0];
    onChange(fallback.id);
  }, [loadedMembers, members, onChange, user?.id, value]);

  const effectiveValue = value ?? user?.id ?? null;
  const selected = members.find((member) => member.id === effectiveValue) ?? null;
  const title = selected ? `Исполнитель: ${selected.displayName}` : 'Выбрать исполнителя';
  const inPropertyRow = (className ?? '').includes('justify-start');

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
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
              loadFailed ? 'Выбрать исполнителя' : 'Загрузка…'
            )}
            {!disabled && <ChevronDown className={PROPERTY_CARET_CLASS} />}
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
        <DropdownMenuRadioGroup value={effectiveValue ?? ''} onValueChange={onChange}>
          {members.map((member) => (
            <DropdownMenuRadioItem
              key={member.id}
              value={member.id}
              indicator={<Check className="size-4 text-primary" aria-hidden="true" />}
              className="gap-2 data-[state=checked]:bg-primary/10"
            >
              <MemberAvatar member={member} />
              <span className={cn('min-w-0 truncate', member.id === effectiveValue && 'font-medium')}>
                {member.displayName}
              </span>
              {member.id === user?.id ? (
                <span className="ms-auto shrink-0 text-2xs text-muted-foreground">вы</span>
              ) : (
                <span className="ms-auto min-w-0 truncate text-2xs text-muted-foreground" title={member.email}>
                  {member.email}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {loadFailed ? (
          <>
            <div role="alert" className="px-2 py-1.5 text-xs text-muted-foreground">
              Не удалось загрузить участников.
            </div>
            <DropdownMenuItem onSelect={(event) => {
              event.preventDefault();
              setLoadAttempt((attempt) => attempt + 1);
            }}>
              Повторить
            </DropdownMenuItem>
          </>
        ) : loadedMembers === null ? (
          <div role="status" className="px-2 py-1.5 text-xs text-muted-foreground">Загрузка участников…</div>
        ) : members.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">В проекте нет участников.</div>
        ) : null}
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
