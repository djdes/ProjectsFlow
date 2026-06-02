import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { VisibleKanbanStatus } from '@/domain/kanban/KanbanSettings';

export type HiddenColumn = {
  status: VisibleKanbanStatus;
  label: string;
};

type Props = {
  hidden: readonly HiddenColumn[];
  onShow: (status: VisibleKanbanStatus) => void;
};

// Меню доски для возврата скрытых колонок (по образцу Notion «Hide group → Edit groups»).
// Рендерится последним элементом ряда колонок; ничего не показывает, когда скрытых нет.
export function KanbanHiddenColumnsMenu({ hidden, onShow }: Props): React.ReactElement | null {
  if (hidden.length === 0) return null;

  return (
    <div className="flex shrink-0 items-start pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
          >
            <EyeOff className="size-4" />
            Скрытые колонки
            <span className="rounded-full bg-muted px-1.5 text-[11px]">{hidden.length}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Показать колонку
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {hidden.map((h) => (
            <DropdownMenuItem key={h.status} onClick={() => onShow(h.status)}>
              <Eye className="size-4" />
              <span className="truncate">{h.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
