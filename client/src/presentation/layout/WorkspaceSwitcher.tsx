import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, Copy, LogOut, Plus, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
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
          title={current.name}
          className={cn(
            'group flex items-center rounded-md text-left text-sm transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.06]',
            compact ? 'justify-center p-1' : 'min-w-0 flex-1 gap-2 px-2 py-1.5',
          )}
        >
          <WorkspaceIcon name={current.name} icon={current.icon} className={compact ? 'size-7 text-sm' : 'size-6'} />
          {!compact && (
            <>
              <span className="min-w-0 flex-1 truncate font-semibold tracking-tight">{current.name}</span>
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
          className="w-64"
        >
          {/* Аккаунт */}
          <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
            <span className="flex-1 truncate">{user.email}</span>
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
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => navigate('/profile')}>
            <Settings />
            Настройки
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut />
            Выйти
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="py-1 text-xs font-normal text-muted-foreground">
            Пространства
          </DropdownMenuLabel>

          <div className="max-h-64 overflow-y-auto">
            {(workspaces ?? []).map((ws) => (
              <div
                key={ws.id}
                className={cn(
                  'group/row flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent',
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
          </div>

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
        </DropdownMenuContent>
      </DropdownMenu>

      <NewWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
