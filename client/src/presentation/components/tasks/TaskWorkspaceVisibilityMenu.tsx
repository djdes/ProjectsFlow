import { Eye, ChevronDown } from 'lucide-react';
import type { Workspace } from '@/domain/workspace/Workspace';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';

type Props = {
  workspaces: readonly Workspace[];
  hiddenIds: readonly string[];
  saving: boolean;
  onVisibleChange: (id: string, visible: boolean) => void;
  onShowAll: () => void;
};

export function TaskWorkspaceVisibilityMenu({ workspaces, hiddenIds, saving, onVisibleChange, onShowAll }: Props): React.ReactElement {
  const visibleCount = workspaces.filter(workspace => !hiddenIds.includes(workspace.id)).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11 shrink-0 gap-2 sm:min-h-8" disabled={saving}>
          <Eye className="size-4" />
          Пространства {visibleCount}/{workspaces.length}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1.5rem)]">
        <DropdownMenuLabel>Показывать на странице «Все задачи»</DropdownMenuLabel>
        {workspaces.map(workspace => (
          <DropdownMenuCheckboxItem key={workspace.id} checked={!hiddenIds.includes(workspace.id)} disabled={saving}
            onCheckedChange={visible => onVisibleChange(workspace.id, visible)}>
            <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="me-2 size-5 shrink-0" />
            <span className="min-w-0 truncate">{workspace.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={saving || visibleCount === workspaces.length} onSelect={onShowAll}>
          Показать все
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
