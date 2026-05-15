import { useNavigate } from 'react-router-dom';
import { LogOut, Monitor, Moon, Settings, Sun, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { useTheme, type Theme } from '@/presentation/components/theme/ThemeProvider';
import { getInitials } from './projectIcons';

export function SidebarUserMenu(): React.ReactElement {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();

  if (loading || !user) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar>
          <AvatarFallback>{getInitials(user.displayName)}</AvatarFallback>
        </Avatar>
        <span className="flex-1 truncate font-medium">{user.displayName}</span>
        <span className="text-muted-foreground" aria-hidden="true">
          ⋯
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/profile')}>
          <UserIcon />
          Профиль
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings />
          Настройки
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />}
            Тема
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(v) => setTheme(v as Theme)}
              >
                <DropdownMenuRadioItem value="light">Светлая</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Тёмная</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">Система</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
