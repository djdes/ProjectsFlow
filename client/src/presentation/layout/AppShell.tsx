import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { NewProjectDialogProvider } from '@/presentation/components/forms/NewProjectDialogProvider';
import { ProjectsProvider } from '@/presentation/hooks/ProjectsProvider';
import { GithubConnectionProvider } from '@/presentation/hooks/GithubConnectionProvider';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { Sidebar } from './Sidebar';

export function AppShell(): React.ReactElement {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ProjectsProvider — внутри ProtectedRoute (этот компонент рендерится только для authenticated),
  // поэтому не делает 401-запросов когда пользователь не залогинен.
  return (
    <ProjectsProvider>
      <GithubConnectionProvider>
        <NewProjectDialogProvider>
        {isDesktop ? (
          <div className="grid h-dvh grid-cols-[260px_1fr] bg-background text-foreground">
            <Sidebar />
            <main className="overflow-y-auto">
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
        </NewProjectDialogProvider>
      </GithubConnectionProvider>
    </ProjectsProvider>
  );
}
