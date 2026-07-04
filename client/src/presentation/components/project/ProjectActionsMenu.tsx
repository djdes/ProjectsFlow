import { Activity, BookOpen, Bot, MoreHorizontal, Settings, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  projectId: string;
  financeVisible: boolean;
  monitoringVisible: boolean;
  monitoringAlerts: number;
  onOpenAutomation: () => void;
};

// Меню «⋯» (Notion top-right): собирает второстепенные действия проекта — Финансы,
// Автоматизация, База знаний, Мониторинг, Настройки — вместо ряда отдельных кнопок.
export function ProjectActionsMenu({
  projectId,
  financeVisible,
  monitoringVisible,
  monitoringAlerts,
  onOpenAutomation,
}: Props): React.ReactElement {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label="Ещё"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {financeVisible && (
          <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/finance`)}>
            <Wallet className="text-muted-foreground" /> Финансы
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onOpenAutomation()}>
          <Bot className="text-muted-foreground" /> Автоматизация
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/kb`)}>
          <BookOpen className="text-muted-foreground" /> База знаний
        </DropdownMenuItem>
        {monitoringVisible && (
          <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/monitoring`)}>
            <Activity className="text-muted-foreground" /> Мониторинг
            {monitoringAlerts > 0 && (
              <span className="ml-auto inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">
                {monitoringAlerts}
              </span>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/overview`)}>
          <Settings className="text-muted-foreground" /> Настройки
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
