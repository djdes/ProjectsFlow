import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Check, Copy, LogOut, Monitor, Moon, Sun, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { useTheme, type Theme } from '@/presentation/components/theme/ThemeProvider';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { avatarColor, getInitials } from './projectIcons';

// compact — режим для свёрнутой панели (icon-rail): триггером служит только аватар.
export function SidebarUserMenu({ compact = false }: { compact?: boolean } = {}): React.ReactElement {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { animations, setAnimations } = useMotion();
  const [copied, setCopied] = useState(false);

  if (loading || !user) {
    return compact ? (
      <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
    ) : (
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

  const copyEmail = (): void => {
    void navigator.clipboard?.writeText(user.email).then(() => {
      setCopied(true);
      toast.success('Email скопирован');
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={compact ? user.displayName : undefined}
        className={cn(
          'flex items-center rounded-md text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'justify-center p-0.5' : 'w-full gap-2 px-2 py-1.5',
        )}
      >
        <Avatar>
          <AvatarFallback className={avatarColor(user.displayName)}>
            {getInitials(user.displayName)}
          </AvatarFallback>
        </Avatar>
        {!compact && (
          <>
            <span className="flex-1 truncate font-medium">{user.displayName}</span>
            <span className="text-muted-foreground" aria-hidden="true">
              ⋯
            </span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align={compact ? 'center' : 'start'} className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
          <span className="flex-1 truncate">{user.email}</span>
          <button
            type="button"
            // не закрываем меню по клику — показываем «скопировано» прямо в нём
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/profile')}>
          <UserIcon />
          Профиль
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/monitoring')}>
          <Activity />
          Мониторинг
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
        <DropdownMenuCheckboxItem
          checked={animations}
          onCheckedChange={setAnimations}
          onSelect={(e) => e.preventDefault()}
        >
          Анимация
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
