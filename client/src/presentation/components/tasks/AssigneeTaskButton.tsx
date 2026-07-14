import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { META_CHIP_CLASS } from './MetaChip';
import type { SharedMember } from '@/application/project/ProjectRepository';
import type { Task } from '@/domain/task/Task';

type Props = {
  task: Task;
  onChanged: () => void;
  projectId?: string;
  className?: string;
  disabled?: boolean;
};

// Единый селектор текущего ответственного. Для первичного назначения,
// переназначения и «забрать себе» используется один идемпотентный endpoint.
export function AssigneeTaskButton({
  task,
  onChanged,
  projectId,
  className,
  disabled = false,
}: Props): React.ReactElement {
  const { projectRepository, taskRepository } = useContainer();
  const { user } = useCurrentUser();
  const [loadedMembers, setLoadedMembers] = useState<SharedMember[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    // Admin-bypass может читать именованный проект, не будучи его участником. Себя
    // такому admin'у не предлагаем: сервер принимает ответственными только members.
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
    if (!byId.has(task.assignee.userId)) {
      byId.set(task.assignee.userId, {
        id: task.assignee.userId,
        displayName: task.assignee.displayName,
        email: '',
        avatarUrl: task.assignee.avatarUrl,
      });
    }
    return [...byId.values()];
  }, [loadedMembers, projectId, task.assignee, user]);

  const select = async (target: SharedMember): Promise<void> => {
    if (submitting || target.id === task.assignee.userId) return;
    setSubmitting(true);
    try {
      await taskRepository.assign(task.projectId, task.id, target.id);
      toast.success(
        target.id === user?.id
          ? 'Теперь вы ответственный'
          : `Ответственный — ${target.displayName}`,
      );
      onChanged();
    } catch (error) {
      toast.error(`Не удалось сменить ответственного: ${(error as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const inPropertyRow = (className ?? '').includes('justify-start');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || submitting}
          className={cn(
            inPropertyRow ? 'text-foreground hover:text-foreground' : META_CHIP_CLASS,
            className,
          )}
          title="Ответственный за задачу. Нажмите, чтобы изменить."
        >
          {submitting ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <MiniAvatar name={task.assignee.displayName} avatarUrl={task.assignee.avatarUrl} />
          )}
          <span className="min-w-0 truncate">{task.assignee.displayName}</span>
          {!disabled && <ChevronDown className="!size-3 shrink-0 opacity-60" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {loadedMembers === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Загрузка…</div>
        ) : (
          members.map((member) => {
            const active = task.assignee.userId === member.id;
            return (
              <DropdownMenuItem
                key={member.id}
                onClick={() => void select(member)}
                className="gap-2"
              >
                <MiniAvatar name={member.displayName} avatarUrl={member.avatarUrl} />
                <span className="min-w-0 truncate">{member.displayName}</span>
                {member.id === user?.id && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">вы</span>
                )}
                {active && <Check className="ml-auto size-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MiniAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }): React.ReactElement {
  return (
    <Avatar className="size-5 shrink-0 rounded-[25%]">
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} className="object-cover" />}
      <AvatarFallback className={cn('rounded-[25%] text-[9px] font-semibold', avatarColor(name))}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
