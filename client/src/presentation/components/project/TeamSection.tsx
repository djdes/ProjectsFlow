import { useEffect, useState } from 'react';
import { MoreVertical, Trash2, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { getInitials } from '@/presentation/layout/projectIcons';
import { OverviewSection } from '@/presentation/components/project/OverviewSection';
import { InviteDialog } from './InviteDialog';

const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: 'владелец',
  editor: 'редактор',
  viewer: 'наблюдатель',
};

const ROLE_BADGE_CLASS: Record<ProjectRole, string> = {
  owner: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  editor: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  viewer: 'bg-muted text-muted-foreground',
};

export function TeamSection({ project }: { project: Project }): React.ReactElement | null {
  const { projectRepository } = useContainer();
  const { user: currentUser } = useCurrentUser();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  const isOwner = project.role === 'owner';
  // С permissions-обновлением invite_member=editor — редактор тоже может приглашать,
  // видеть и отзывать pending-инвайты. Viewer — нет.
  const canInvite = project.role === 'owner' || project.role === 'editor';

  // В inbox команды не бывает (см. spec, решение 3). Скрываем секцию целиком.
  // Также защита: если как-то сервер отдал isInbox=true, мы не показываем UI.
  const skip = project.isInbox;

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    setLoading(true);
    const loadAll = async (): Promise<void> => {
      try {
        const membersList = await projectRepository.listMembers(project.id);
        if (cancelled) return;
        setMembers(membersList);
      } catch (e) {
        if (!cancelled) {
          toast.error(`Не удалось загрузить команду: ${(e as Error).message}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [project.id, projectRepository, canInvite, skip]);

  if (skip) return null;

  const handleInviteCreated = (invite: WorkspaceInvite): void => {
    if (invite.url) {
      // Сразу копируем ссылку — самый частый следующий шаг.
      void navigator.clipboard.writeText(invite.url).then(
        () => toast.success('Ссылка скопирована'),
        () => toast.success('Приглашение создано'),
      );
    }
  };

  const handleRoleChange = async (
    member: ProjectMember,
    newRole: Exclude<ProjectRole, 'owner'>,
  ): Promise<void> => {
    try {
      await projectRepository.updateMemberRole(project.id, member.userId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.userId === member.userId ? { ...m, role: newRole } : m)),
      );
      toast.success('Роль обновлена');
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleRemoveMember = async (member: ProjectMember): Promise<void> => {
    const isSelf = currentUser?.id === member.userId;
    const confirmText = isSelf
      ? 'Выйти из проекта? Доступ можно будет восстановить только новым приглашением.'
      : `Удалить ${member.user.displayName} из проекта?`;
    if (!window.confirm(confirmText)) return;
    try {
      await projectRepository.removeMember(project.id, member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      toast.success(isSelf ? 'Ты вышел из проекта' : 'Участник удалён');
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleTransfer = async (member: ProjectMember): Promise<void> => {
    if (
      !window.confirm(
        `Передать владение проектом «${project.name}» участнику ${member.user.displayName}? Ты станешь редактором.`,
      )
    )
      return;
    try {
      await projectRepository.transferOwnership(project.id, member.userId);
      toast.success('Владение передано. Обнови страницу.');
      // Лениво обновляем locally — после refresh страница покажет реальные роли.
      setMembers((prev) =>
        prev.map((m) => {
          if (m.userId === member.userId) return { ...m, role: 'owner' };
          if (m.userId === currentUser?.id) return { ...m, role: 'editor' };
          return m;
        }),
      );
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  return (
    <OverviewSection
      title="Команда"
      actions={
        canInvite && (
          <Button size="sm" variant="outline" onClick={() => setShowInviteDialog(true)}>
            <UserPlus className="size-4" />
            Пригласить
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          </div>
        ) : (
          <ul className="space-y-1">
            {members.map((m) => (
              <li
                key={m.userId}
                className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
              >
                <Avatar className="size-8 shrink-0">
                  {m.user.avatarUrl ? (
                    <AvatarImage src={m.user.avatarUrl} alt={m.user.displayName} />
                  ) : null}
                  <AvatarFallback>{getInitials(m.user.displayName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.user.displayName}
                    {currentUser?.id === m.userId && (
                      <span className="ml-1 text-xs text-muted-foreground">(ты)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    ROLE_BADGE_CLASS[m.role],
                  )}
                >
                  {ROLE_LABEL[m.role]}
                </span>
                {/* Меню owner'а: change role + remove + transfer. Editor/viewer не видят. */}
                {isOwner && m.role !== 'owner' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Действия"
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuRadioGroup
                        value={m.role}
                        onValueChange={(v) =>
                          void handleRoleChange(m, v as Exclude<ProjectRole, 'owner'>)
                        }
                      >
                        <DropdownMenuRadioItem value="editor">Редактор</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="viewer">Наблюдатель</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void handleTransfer(m)}>
                        Передать владение
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => void handleRemoveMember(m)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                        Удалить
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Свой self-exit для non-owner. */}
                {!isOwner && currentUser?.id === m.userId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => void handleRemoveMember(m)}
                  >
                    Выйти
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <InviteDialog
        open={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        onCreated={handleInviteCreated}
      />
    </OverviewSection>
  );
}
