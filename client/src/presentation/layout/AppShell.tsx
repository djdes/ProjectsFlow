import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { NewProjectDialogProvider } from '@/presentation/components/forms/NewProjectDialogProvider';
import { AddTaskDialogProvider } from '@/presentation/components/forms/AddTaskDialogProvider';
import { GlobalSearchProvider } from '@/presentation/components/search/GlobalSearchProvider';
import { ProjectsProvider } from '@/presentation/hooks/ProjectsProvider';
import { GithubConnectionProvider } from '@/presentation/hooks/GithubConnectionProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { useNotificationStream } from '@/presentation/hooks/useNotificationStream';
import { Sidebar } from './Sidebar';

const COLLAPSE_KEY = 'pf_sidebar_collapsed';

export function AppShell(): React.ReactElement {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Свёрнутость левой панели (desktop), переживает перезагрузку.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* localStorage недоступен — состояние просто не персистится */
      }
      return next;
    });
  }, []);

  // SSE real-time-уведомления (toast + мгновенный бейдж). Только для authenticated-сессии,
  // которой и является AppShell (рендерится внутри ProtectedRoute).
  useNotificationStream();

  // ProjectsProvider — внутри ProtectedRoute (этот компонент рендерится только для authenticated),
  // поэтому не делает 401-запросов когда пользователь не залогинен.
  return (
    <ProjectsProvider>
      <GithubConnectionProvider>
        <NewProjectDialogProvider>
        <AddTaskDialogProvider>
        <GlobalSearchProvider>
        {isDesktop ? (
          <div
            className={cn(
              'grid h-dvh bg-background text-foreground',
              collapsed ? 'grid-cols-[3.5rem_1fr]' : 'grid-cols-[260px_1fr]',
            )}
          >
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
            <main className="relative overflow-y-auto">
              <Outlet />
            </main>
          </div>
        ) : (
          <div className="flex h-dvh flex-col bg-background text-foreground">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(true)}
                aria-label="Открыть меню"
              >
                <Menu />
              </Button>
              <span className="text-sm font-semibold">ProjectsFlow</span>
            </header>
            <main className="flex-1 overflow-y-auto">
              <Outlet />
            </main>
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetContent side="left" className="w-72 p-0">
                <div onClick={() => setDrawerOpen(false)} className="h-full">
                  <Sidebar />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        )}
        </GlobalSearchProvider>
        </AddTaskDialogProvider>
        </NewProjectDialogProvider>
      </GithubConnectionProvider>
    </ProjectsProvider>
  );
}
