import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AnimatedInbox } from '@/presentation/components/nav/AnimatedNavIcons';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { useSwitchWorkspace } from '@/presentation/hooks/useSwitchWorkspace';
import { WorkspaceIcon } from './WorkspaceIcon';

// Хлебные крошки страниц пространства в Notion-стиле: «<Пространство> ▾ › <Страница>».
// Сегмент пространства раскрывается ПРИ НАВЕДЕНИИ (как ProjectBreadcrumbs) и даёт быстро
// переключить пространство. Зеркалит хелпер hover-меню из ProjectBreadcrumbs (намеренно
// дублируем малый код, чтобы не лезть в чужой файл и не ловить конфликт со встречной сессией).

function useHoverMenu(): {
  open: boolean;
  setOpen: (v: boolean) => void;
  openNow: () => void;
  closeSoon: () => void;
} {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const openNow = (): void => {
    cancel();
    setOpen(true);
  };
  const closeSoon = (): void => {
    cancel();
    timer.current = window.setTimeout(() => setOpen(false), 140);
  };
  return { open, setOpen, openNow, closeSoon };
}

// Дизайн C4: крошки — 13px, вторичный цвет; текущая страница — основным цветом без подложки,
// у остальных сегментов мягкая подложка по наведению.
const segmentClass = (current?: boolean): string =>
  cn(
    'flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors',
    current ? 'text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
  );

// Крошки «<Пространство> ▾ › <иконка> <страница>» для разделов вне проекта: входящие,
// профиль, настройки, администрирование, мониторинг.
export function WorkspaceCrumbs({
  icon,
  label,
}: {
  icon?: React.ReactNode;
  label: string;
}): React.ReactElement {
  const navigate = useNavigate();
  const { workspace } = useCurrentWorkspace();
  const { data: workspaces } = useWorkspaces();
  const { switchTo } = useSwitchWorkspace();
  const wsMenu = useHoverMenu();

  const handleSwitch = (id: string): void => {
    wsMenu.setOpen(false);
    if (id === workspace?.id) return;
    void switchTo(id);
    navigate('/');
  };

  return (
    <nav
      // pf-burger-gap — маркер «здесь может стоять плавающий бургер свёрнутой панели».
      // Сам отступ и условие его появления задаёт globals.css по data-атрибуту AppShell.
      className="pf-burger-gap flex min-w-0 items-center gap-0.5 text-ui"
      aria-label="Хлебные крошки"
    >
      {/* Сегмент пространства — hover-дропдаун для быстрого переключения между пространствами. */}
      <DropdownMenu open={wsMenu.open} onOpenChange={wsMenu.setOpen} modal={false}>
        <DropdownMenuTrigger
          className={cn(segmentClass(), 'min-w-0')}
          onMouseEnter={wsMenu.openNow}
          onMouseLeave={wsMenu.closeSoon}
        >
          <WorkspaceIcon name={workspace?.name ?? 'П'} icon={workspace?.icon ?? null} className="size-4 text-[9px]" />
          <span className="max-w-[12rem] truncate">{workspace?.name ?? 'Пространство'}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 w-60 overflow-y-auto"
          onMouseEnter={wsMenu.openNow}
          onMouseLeave={wsMenu.closeSoon}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel>Сменить пространство</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(workspaces ?? []).map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => handleSwitch(w.id)}
              className={cn(w.id === workspace?.id && 'font-medium')}
            >
              <WorkspaceIcon name={w.name} icon={w.icon} className="size-4 text-[9px]" />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === workspace?.id && <Check className="size-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />

      {/* Текущая страница (не кликается). */}
      <span className={cn(segmentClass(true), 'pointer-events-none min-w-0')} aria-current="page">
        {icon}
        <span className="truncate">{label}</span>
      </span>
    </nav>
  );
}

export function InboxBreadcrumbs(): React.ReactElement {
  return (
    <WorkspaceCrumbs icon={<AnimatedInbox active className="size-3.5 shrink-0" />} label="Входящие" />
  );
}
