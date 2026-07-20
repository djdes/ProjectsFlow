import { ChevronDown, LayoutDashboard, Menu, Palette, PanelLeftClose, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AiSelectionRef } from '@/domain/ai-chat/AiSelectionRef';
import { AiConversationView } from '@/presentation/components/ai/AiConversationView';
import type { DashboardSection } from '@/presentation/components/project/workspace/dashboard/dashboardConfig';
import type { StudioSplitPane } from './useStudioSplitPane';
import { StudioThemePanel } from './StudioThemePanel';
import { SaveStatusIndicator, type StudioSaveState } from './SaveStatusIndicator';
import { useState } from 'react';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { useSidebarCollapsed } from '@/presentation/layout/sidebarCollapsedContext';

// Тёмный тултип — как в Base44. Глобальный TooltipContent светлый (bg-popover) и трогать
// его нельзя: он обслуживает ещё десяток мест. Поэтому красим точечно, здесь.
const DARK_TOOLTIP = 'border-transparent bg-neutral-900 text-white';

export function StudioChatPane({
  conversationId,
  projectId,
  projectName,
  projectIcon,
  splitPane,
  saveState,
  onOpenDashboardSection,
  onOpenSelection,
  selection,
  onBuild,
}: {
  conversationId: string;
  projectId: string;
  projectName: string;
  projectIcon: string | null;
  splitPane: StudioSplitPane;
  // Статус сохранения правок превью — живёт в правой панели, показывается здесь.
  saveState: StudioSaveState;
  onOpenDashboardSection: (section: DashboardSection) => void;
  // Клик по чипу зоны в сообщении: открыть предпросмотр на нужной странице и выделить
  // тот же элемент. Владелец состояния — страница студии.
  onOpenSelection?: (selection: AiSelectionRef) => void;
  // Зона, выделенная в превью прямо сейчас, — тоже поднята страницей студии.
  selection?: AiSelectionRef | null;
  // Отправка в режиме «Правка»: промпт уходит в job визуального редактора. Промис
  // отклоняется, если правку не приняли, — по нему чат вернёт текст в композер.
  onBuild?: (prompt: string) => void | Promise<void>;
}): React.ReactElement {
  const [themeOpen, setThemeOpen] = useState(false);
  // Бургер открывает основную панель — когда она и так открыта, кнопка бессмысленна
  // и просто дублирует навигацию, занимая место в и без того тесной шапке.
  const sidebarCollapsed = useSidebarCollapsed();
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
        <div style={splitPane.contentStyle} className="relative flex h-full min-h-0 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
            {sidebarCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
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
                </TooltipTrigger>
                <TooltipContent side="bottom" className={DARK_TOOLTIP}>Открыть основную панель</TooltipContent>
              </Tooltip>
            )}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="flex min-w-0 max-w-[calc(100%_-_116px)] items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm font-semibold transition hover:bg-muted" aria-label={`Разделы проекта ${projectName}`}>
                      <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-xs" aria-hidden>
                        {projectIcon ? <ProjectIconView icon={projectIcon} pixelSize={18} /> : (projectName.trim()[0] ?? '?').toUpperCase()}
                      </span>
                      <span className="truncate">{projectName}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className={DARK_TOOLTIP}>Разделы проекта</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-64">
                {dashboardLinks.map(({ label, section, icon: Icon }) => <DropdownMenuItem key={section} onSelect={() => onOpenDashboardSection(section)}><Icon />{label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="min-w-0 flex-1" aria-hidden />
            {/* Как в Base44: статус сохранения прижат к правому краю, первым в группе
                иконок — сразу перед сменой темы. */}
            <SaveStatusIndicator state={saveState} />
            <Popover open={themeOpen} onOpenChange={setThemeOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Тема проекта"><Palette className="size-4" /></Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className={DARK_TOOLTIP}>Тема проекта</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" sideOffset={8} className="w-auto overflow-hidden p-0">
                <StudioThemePanel conversationId={conversationId} projectName={projectName} onClose={() => setThemeOpen(false)} />
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Скрыть панель чата" onClick={() => splitPane.setHidden(true)}><PanelLeftClose className="size-4" /></Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={DARK_TOOLTIP}>Скрыть панель чата</TooltipContent>
            </Tooltip>
          </header>
          <div className="min-h-0 flex-1"><AiConversationView conversationId={conversationId} projectId={projectId} projectName={projectName} hideHeader onOpenSelection={onOpenSelection} selection={selection} onBuild={onBuild} /></div>
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
