import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, CircleArrowUp, Copy, Gauge, Home, Plus, Settings, UserPlus } from 'lucide-react';
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
import { ViewableAvatar } from '@/presentation/components/user/ViewableAvatar';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useSwitchWorkspace } from '@/presentation/hooks/useSwitchWorkspace';
import { NewWorkspaceDialog } from '@/presentation/components/forms/NewWorkspaceDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WorkspaceIcon } from './WorkspaceIcon';
import { useUsageDialog } from '@/presentation/usage/UsageDialogProvider';
import { useUpgradeDialog } from '@/presentation/usage/UpgradeDialogProvider';
import { useUsage } from '@/presentation/usage/UsageProvider';
import { planHeaderLine } from '@/presentation/usage/usageFormat';

// «1 проект» / «2 проекта» / «5 проектов» — для тултипа пространства (кол-во проектов —
// единственная per-workspace метрика в read-model; числа участников в списке нет).
function projectsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} проект`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} проекта`;
  return `${n} проектов`;
}

// «1 участник» / «2 участника» / «5 участников» — вторая строка тултипа пространства.
function membersLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} участник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} участника`;
  return `${n} участников`;
}

// compact — режим icon-rail (свёрнутая панель): триггер только иконка пространства.
export function WorkspaceSwitcher({ compact = false }: { compact?: boolean } = {}): React.ReactElement {
  const navigate = useNavigate();
  const { user, loading: userLoading } = useCurrentUser();
  const { logout } = useAuth();
  const { data: workspaces } = useWorkspaces();
  const { workspace: current, loading: wsLoading } = useCurrentWorkspace();
  const { switchTo } = useSwitchWorkspace();
  const usageDialog = useUsageDialog();
  const upgrade = useUpgradeDialog();
  const { usage } = useUsage();
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
          {/* Шапка: аватар + никнейм + строка тарифа со сроком (как «Free Plan · …» в Notion). */}
          <div className="flex items-center gap-3 px-3 py-3">
            <ViewableAvatar
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              className="size-10 text-base"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight">{user.displayName}</div>
              {usage && (
                <div className="truncate text-xs text-muted-foreground">
                  {planHeaderLine(usage.plan, usage.subscription.expiresAt)}
                </div>
              )}
            </div>
          </div>

          <DropdownMenuSeparator className="my-0" />

          {/* Действия */}
          <div className="p-1">
            <DropdownMenuItem
              onClick={() => {
                setOpen(false);
                upgrade.open();
              }}
              className="text-primary focus:text-primary"
            >
              <CircleArrowUp />
              Улучшить план
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setOpen(false);
                usageDialog.open();
              }}
            >
              <Gauge />
              Лимиты
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

          {/* Над списком пространств — email аккаунта (клик копирует), как в Notion. */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              copyEmail();
            }}
            aria-label="Скопировать email"
            title="Скопировать email"
            className="group/mail flex w-full items-center gap-1.5 px-3 pt-1.5 pb-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 truncate">{user.email}</span>
            {copied ? (
              <Check className="size-3 shrink-0" />
            ) : (
              <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/mail:opacity-100" />
            )}
          </button>

          <div className="max-h-56 overflow-y-auto p-1">
            <TooltipProvider delayDuration={200}>
              {(workspaces ?? []).map((ws) => (
                <Tooltip key={ws.id}>
                  {/* Триггер — вся строка: тултип встаёт у ПРАВОГО края всего окна. */}
                  <TooltipTrigger asChild>
                    <div className="group/row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                      <button
                        type="button"
                        onClick={() => handleSwitch(ws.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
                      >
                        <WorkspaceIcon name={ws.name} icon={ws.icon} className="size-5 text-[10px]" />
                        {/* Название не растягиваем — домик встаёт вплотную после него. */}
                        <span className="min-w-0 truncate">{ws.name}</span>
                        {ws.kind === 'default' && (
                          <span title="Пространство по умолчанию" className="inline-flex shrink-0 text-muted-foreground">
                            <Home className="size-3.5" aria-hidden="true" />
                          </span>
                        )}
                      </button>
                      {/* Правый край: галочка (текущее) → на hover сменяется кнопкой настроек. */}
                      <div className="relative size-6 shrink-0">
                        {ws.isCurrent && (
                          <Check className="absolute inset-0 m-auto size-4 text-foreground transition-opacity group-hover/row:opacity-0" />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSettings(ws.id);
                          }}
                          aria-label={`Настройки пространства «${ws.name}»`}
                          className="absolute inset-0 grid place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
                        >
                          <Settings className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </TooltipTrigger>
                  {/* Всегда справа за окном (avoidCollisions=false → не перекидывается). */}
                  <TooltipContent
                    side="right"
                    align="center"
                    avoidCollisions={false}
                    sideOffset={10}
                    className="border-transparent bg-foreground text-background"
                  >
                    <div>{projectsLabel(ws.projectCount)}</div>
                    <div className="text-background/70">{membersLabel(ws.memberCount)}</div>
                  </TooltipContent>
                </Tooltip>
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
            </TooltipProvider>
          </div>

          <DropdownMenuSeparator className="my-0" />

          {/* Выход — в самом низу, минималистично: без иконки, приглушённый */}
          <div className="p-1">
            <DropdownMenuItem onClick={handleLogout} className="text-muted-foreground focus:text-foreground">
              Выйти
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
