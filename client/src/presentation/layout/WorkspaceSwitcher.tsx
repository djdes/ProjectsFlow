import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, CircleArrowUp, Copy, Home, LogOut, Plus, Settings, UserPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useSwitchWorkspace } from '@/presentation/hooks/useSwitchWorkspace';
import { NewWorkspaceDialog } from '@/presentation/components/forms/NewWorkspaceDialog';
import { WorkspaceIcon } from './WorkspaceIcon';

// compact — режим icon-rail (свёрнутая панель): триггер только иконка пространства.
export function WorkspaceSwitcher({ compact = false }: { compact?: boolean } = {}): React.ReactElement {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useCurrentUser();
  const { logout } = useAuth();
  const { data: workspaces } = useWorkspaces();
  const { workspace: current, loading: wsLoading } = useCurrentWorkspace();
  const { switchTo } = useSwitchWorkspace();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (wsLoading || userLoading || !current || !user) {
    return compact ? (
      <div className="size-9 shrink-0 animate-pulse rounded-md bg-muted" />
    ) : (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <div className="size-6 shrink-0 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  const copyEmail = (): void => {
    void navigator.clipboard?.writeText(user.email).then(() => {
      setCopied(true);
      toast.success('Email скопирован');
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleSwitch = (id: string): void => {
    setOpen(false);
    if (id === current.id) return;
    void switchTo(id);
    navigate('/');
  };

  const openSettings = (id: string): void => {
    setOpen(false);
    navigate(`/workspaces/${id}/settings`);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          title={user.displayName}
          className={cn(
            'group flex items-center rounded-md text-left text-sm transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.06]',
            compact ? 'justify-center p-1' : 'min-w-0 flex-1 gap-2 px-2 py-1.5',
          )}
        >
          <UserAvatar
            displayName={user.displayName}
            avatarUrl={user.avatarUrl}
            className={compact ? 'size-7 text-sm' : 'size-6 text-xs'}
          />
          {!compact && (
            <>
              <span className="min-w-0 flex-1 truncate font-semibold tracking-tight">
                {user.displayName}
              </span>
              <ChevronsUpDown
                className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=open]:opacity-100"
                aria-hidden="true"
              />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side={compact ? 'right' : 'bottom'}
          align="start"
          sideOffset={compact ? 8 : 4}
          className="w-72 p-0"
        >
          {/* Шапка: аватар + никнейм пользователя + email (с копированием). */}
          <div className="flex items-center gap-3 px-3 py-3">
            <UserAvatar
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              className="size-10 text-base"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight">{user.displayName}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                copyEmail();
              }}
              aria-label="Скопировать email"
              title="Скопировать email"
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>

          <DropdownMenuSeparator className="my-0" />

          {/* Действия */}
          <div className="p-1">
            <DropdownMenuItem onClick={() => navigate('/profile')} className="text-primary focus:text-primary">
              <CircleArrowUp />
              Улучшить план
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <Settings />
              Настройки
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openSettings(current.id)}>
              <UserPlus />
              Пригласить участников
            </DropdownMenuItem>
          </div>

          <DropdownMenuSeparator className="my-0" />

          {/* Список пространств */}
          <div className="px-3 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Пространства
          </div>

          <div className="max-h-56 overflow-y-auto p-1">
            {(workspaces ?? []).map((ws) => (
              <div
                key={ws.id}
                className={cn(
                  'group/row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                  ws.isCurrent && 'font-medium',
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSwitch(ws.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
                >
                  <WorkspaceIcon name={ws.name} icon={ws.icon} className="size-5 text-[10px]" />
                  <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                  {ws.kind === 'default' && (
                    <span
                      title="Пространство по умолчанию — все ваши проекты"
                      className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground"
                    >
                      <Home className="size-3" aria-hidden="true" />
                      по умолчанию
                    </span>
                  )}
                  {ws.isCurrent && <Check className="size-4 shrink-0 text-primary motion-safe:animate-in motion-safe:zoom-in-50" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSettings(ws.id);
                  }}
                  aria-label={`Настройки пространства «${ws.name}»`}
                  title="Настройки пространства"
                  className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
                >
                  <Settings className="size-3.5" />
                </button>
              </div>
            ))}
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setOpen(false);
                setCreateOpen(true);
              }}
              className="text-primary focus:text-primary"
            >
              <Plus />
              Новое пространство
            </DropdownMenuItem>
          </div>

          <DropdownMenuSeparator className="my-0" />

          {/* Выход — в самом низу */}
          <div className="p-1">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut />
              Выйти
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
