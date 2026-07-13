import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Project } from '@/domain/project/Project';
import type { WorkspaceMember, WorkspaceRole } from '@/domain/workspace/Workspace';
import type { WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { getInitials } from '@/presentation/layout/projectIcons';
import { OverviewSection } from '@/presentation/components/project/OverviewSection';
import { InviteDialog } from './InviteDialog';

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  // «Владелец» — концепт пространства (показывается на настройках пространства), а не проекта:
  // на уровне проекта роли — «редактор»/«наблюдатель», а создателя помечаем «создал» ниже.
  owner: 'редактор',
  editor: 'редактор',
  viewer: 'наблюдатель',
};

const ROLE_BADGE_CLASS: Record<WorkspaceRole, string> = {
  owner: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  editor: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  viewer: 'bg-muted text-muted-foreground',
};

// Бейдж создателя проекта (projects.owner_id) — нейтральное «создал», без роли «владелец».
const CREATOR_BADGE_CLASS = 'bg-amber-500/15 text-amber-700 dark:text-amber-400';

// Секция «Команда» на странице проекта. После унификации доступа команда — это участники
// ПРОСТРАНСТВА проекта (read-only список). Управление ролями/удаление/инвайт-лист — на
// странице настроек пространства (ссылка «Управлять командой» для owner'а).
export function TeamSection({ project }: { project: Project }): React.ReactElement | null {
  const { workspaceRepository } = useContainer();
  const { user: currentUser } = useCurrentUser();
  const { workspace } = useCurrentWorkspace();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  const isOwner = workspace?.role === 'owner';
  const canInvite = workspace?.role === 'owner' || workspace?.role === 'editor';

  // В inbox команды не бывает — секцию не показываем.
  const skip = project.isInbox;
  const workspaceId = workspace?.id ?? null;

  useEffect(() => {
    if (skip || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    workspaceRepository
      .listMembers(workspaceId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Не удалось загрузить команду: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRepository, workspaceId, skip]);

  if (skip) return null;

  const handleInviteCreated = (invite: WorkspaceInvite): void => {
    if (invite.url) {
      void navigator.clipboard.writeText(invite.url).then(
        () => toast.success('Ссылка скопирована'),
        () => toast.success('Приглашение создано'),
      );
    }
  };

  return (
    <OverviewSection
      title="Команда"
      actions={
        <div className="flex items-center gap-1.5">
          {isOwner && workspaceId && (
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
              <Link to={`/workspaces/${workspaceId}/settings`}>
                <Settings2 className="size-4" />
                Управлять командой
              </Link>
            </Button>
          )}
          {canInvite && (
            <Button size="sm" variant="outline" onClick={() => setShowInviteDialog(true)}>
              <UserPlus className="size-4" />
              Пригласить
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Участники пространства{workspace ? ` «${workspace.name}»` : ''} — им доступны все его
          проекты.
        </p>
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          </div>
        ) : (
          <ul className="space-y-1">
            {members.map((m) => {
              const isCreator = m.userId === project.ownerId;
              return (
              <li
                key={m.userId}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
              >
                <Avatar className="size-8 shrink-0">
                  {m.avatarUrl ? (
                    <AvatarImage src={m.avatarUrl} alt={m.displayName ?? ''} />
                  ) : null}
                  <AvatarFallback>{getInitials(m.displayName ?? m.email ?? '?')}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.displayName ?? '—'}
                    {currentUser?.id === m.userId && (
                      <span className="ml-1 text-xs text-muted-foreground">(ты)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    isCreator ? CREATOR_BADGE_CLASS : ROLE_BADGE_CLASS[m.role],
                  )}
                >
                  {isCreator ? 'создал' : ROLE_LABEL[m.role]}
                </span>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <InviteDialog
        open={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        workspaceId={workspaceId ?? undefined}
        onCreated={handleInviteCreated}
      />
    </OverviewSection>
  );
}
