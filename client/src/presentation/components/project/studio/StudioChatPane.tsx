import { ChevronDown, LayoutDashboard, Menu, Palette, PanelLeftClose, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AiConversationView } from '@/presentation/components/ai/AiConversationView';
import type { DashboardSection } from '@/presentation/components/project/workspace/dashboard/dashboardConfig';
import type { StudioSplitPane } from './useStudioSplitPane';
import { StudioThemePanel } from './StudioThemePanel';
import { useState } from 'react';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';

export function StudioChatPane({
  conversationId,
  projectId,
  projectName,
  projectIcon,
  splitPane,
  onOpenDashboardSection,
}: {
  conversationId: string;
  projectId: string;
  projectName: string;
  projectIcon: string | null;
  splitPane: StudioSplitPane;
  onOpenDashboardSection: (section: DashboardSection) => void;
}): React.ReactElement {
  const [themeOpen, setThemeOpen] = useState(false);
  const dashboardLinks: Array<{ label: string; section: DashboardSection; icon: typeof LayoutDashboard }> = [
    { label: 'Обзор приложения', section: 'overview', icon: LayoutDashboard },
    { label: 'Пользователи', section: 'users', icon: Users },
    { label: 'Безопасность', section: 'security', icon: ShieldCheck },
    { label: 'Настройки приложения', section: 'settings', icon: Settings2 },
  ];
  return (
    <>
      <aside
        aria-label="AI-чат проекта"
        aria-hidden={splitPane.hidden || undefined}
        inert={splitPane.hidden || undefined}
        style={splitPane.paneStyle}
        className={cn(
          'relative hidden h-full min-h-0 shrink-0 overflow-hidden bg-background lg:block',
          splitPane.dragging && 'select-none',
        )}
      >
        <div style={{ width: splitPane.width }} className="relative flex h-full min-h-0 flex-col">
          <header className="flex h-[52px] shrink-0 items-center gap-1 border-b px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg p-0"
              aria-label="Открыть основную панель"
              onClick={() => window.dispatchEvent(new CustomEvent('pf:set-sidebar-collapsed', { detail: { collapsed: false } }))}
            >
              <Menu className="size-[18px]" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex min-w-0 max-w-[calc(100%_-_116px)] items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm font-semibold transition hover:bg-muted" aria-label={`Разделы проекта ${projectName}`}>
                  <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-xs" aria-hidden>
                    {projectIcon ? <ProjectIconView icon={projectIcon} pixelSize={18} /> : (projectName.trim()[0] ?? '?').toUpperCase()}
                  </span>
                  <span className="truncate">{projectName}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {dashboardLinks.map(({ label, section, icon: Icon }) => <DropdownMenuItem key={section} onSelect={() => onOpenDashboardSection(section)}><Icon />{label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover open={themeOpen} onOpenChange={setThemeOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Тема проекта"><Palette className="size-4" /></Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-auto overflow-hidden p-0">
                <StudioThemePanel conversationId={conversationId} projectName={projectName} onClose={() => setThemeOpen(false)} />
              </PopoverContent>
            </Popover>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Скрыть панель чата" onClick={() => splitPane.setHidden(true)}><PanelLeftClose className="size-4" /></Button>
          </header>
          <div className="min-h-0 flex-1"><AiConversationView conversationId={conversationId} projectId={projectId} projectName={projectName} hideHeader /></div>
        </div>
      </aside>
      {!splitPane.hidden && (
        <div
          {...splitPane.separatorProps}
          className={cn(
            'group relative z-20 hidden h-full w-px shrink-0 cursor-col-resize bg-border outline-none lg:block',
            'before:absolute before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
            'hover:after:bg-primary/50 focus-visible:after:bg-primary',
            splitPane.dragging && 'after:bg-primary',
          )}
        />
      )}
    </>
  );
}
