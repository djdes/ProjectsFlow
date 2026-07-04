import { Activity, BookOpen, Bot, MoreHorizontal, Settings, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {financeVisible && (
          <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/finance`)}>
            <Wallet /> Финансы
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onOpenAutomation()}>
          <Bot /> Автоматизация
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/kb`)}>
          <BookOpen /> База знаний
        </DropdownMenuItem>
        {monitoringVisible && (
          <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/monitoring`)}>
            <Activity /> Мониторинг
            {monitoringAlerts > 0 && (
              <span className="ml-auto inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">
                {monitoringAlerts}
              </span>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/overview`)}>
          <Settings /> Настройки
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
