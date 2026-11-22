import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronsUpDown, Plus, Settings } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useSwitchWorkspace } from '@/presentation/hooks/useSwitchWorkspace';
import { NewWorkspaceDialog } from '@/presentation/components/forms/NewWorkspaceDialog';
import { WorkspaceIcon } from './WorkspaceIcon';

/** A direct workspace switch; account actions remain in the sidebar profile menu. */
export function QuickWorkspaceSwitcher(): React.ReactElement {
  const navigate = useNavigate();
  const { data: workspaces } = useWorkspaces();
  const { workspace } = useCurrentWorkspace();
  const { switchTo, switching } = useSwitchWorkspace();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  if (!workspace) return <div className="h-6 min-w-0 flex-1 rounded bg-muted" aria-label="Загрузка пространства" />;
  const select = (id: string): void => {
    setOpen(false);
    if (id === workspace.id || switching) return;
    // The existing boundary hides all old data until the scoped switch is acknowledged.
    void switchTo(id).catch(() => toast.error('Не удалось переключить пространство. Попробуйте ещё раз.'));
    navigate('/');
  };

  return <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={switching}
        aria-label={`Сменить пространство: ${workspace.name}`}
        title="Сменить пространство"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 text-start text-sm font-semibold transition-colors active:bg-accent data-[state=open]:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [@media(hover:hover)_and_(pointer:fine)]:hover:bg-hover"
      >
        {/* Общий значок «пространства» вместо буквы-аватара: буква читалась как проект или
            профиль, а не как переключатель команды. Свои значки пространств — в списке ниже. */}
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Building2 className="size-4" />
        </span>
        <span className="min-w-0 truncate">{workspace.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72" aria-label="Сменить пространство">
        <DropdownMenuLabel>Пространства</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={workspace.id} onValueChange={select}>
          {(workspaces ?? []).map((item) => <DropdownMenuRadioItem key={item.id} value={item.id}
            indicator={<Check className="size-4 text-primary" aria-hidden="true" />}
            className="min-h-11 gap-2 data-[state=checked]:bg-primary/10">
            <WorkspaceIcon name={item.name} icon={item.icon} className="size-6 shrink-0 text-xs" />
            <span className="min-w-0 truncate">{item.name}</span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" onSelect={() => navigate(`/workspaces/${workspace.id}/settings`)}><Settings />Настройки пространства</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => { setOpen(false); setCreateOpen(true); }}><Plus />Новое пространство</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <NewWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
  </>;
}
