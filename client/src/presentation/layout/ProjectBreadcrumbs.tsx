import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  ChevronRight,
  FolderOpen,
  LayoutGrid,
  Info,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjects } from '@/presentation/hooks/useProjects';
import { avatarColor } from './projectIcons';

// Notion-style крошки для страниц проекта: «Проекты ▾ · {проект} ▾ · {вид}».
// Каждый сегмент с иконкой, hover-подсветкой и дропдауном навигации, который
// раскрывается ПРИ НАВЕДЕНИИ (не по клику): «Проекты» → переход к любому проекту;
// сегмент проекта → переключение между его видами.

export type ProjectViewKey = 'board' | 'overview' | 'kb' | 'monitoring' | 'finance';

type ViewDef = { key: ProjectViewKey; label: string; Icon: LucideIcon; path: (id: string) => string };

const VIEWS: readonly ViewDef[] = [
  { key: 'board', label: 'Доска задач', Icon: LayoutGrid, path: (id) => `/projects/${id}` },
  { key: 'overview', label: 'Обзор', Icon: Info, path: (id) => `/projects/${id}/overview` },
  { key: 'kb', label: 'База знаний', Icon: BookOpen, path: (id) => `/projects/${id}/kb` },
  { key: 'monitoring', label: 'Мониторинг', Icon: Activity, path: (id) => `/projects/${id}/monitoring` },
  { key: 'finance', label: 'Финансы', Icon: Wallet, path: (id) => `/projects/${id}/finance` },
];

// Раскрытие дропдауна по наведению с небольшой задержкой на закрытие — чтобы успеть
// перевести курсор с триггера на контент (между ними есть зазор).
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

// Маленький чип-аватар проекта: эмодзи (если задан) или цветная буква (как в сайдбаре).
function ProjectChip({ name, icon }: { name: string; icon?: string | null }): React.ReactElement {
  if (icon) {
    return (
      <span className="grid size-4 shrink-0 place-items-center text-sm leading-none" aria-hidden>
        {icon}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded text-[9px] font-semibold leading-none',
        avatarColor(name),
      )}
      aria-hidden
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

// Общий вид сегмента-кнопки (триггер дропдауна). Notion-style: при hover нейтральная
// заливка bg-hover; текущий сегмент — отчётливая мягкая «пилюля» (более плотная заливка),
// чтобы текущая страница ясно читалась, а не выглядела чуть жирнее остальных.
const segmentClass = (current?: boolean): string =>
  cn(
    'flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
    current
      ? 'bg-foreground/[0.08] font-medium text-foreground dark:bg-white/[0.10]'
      : 'text-muted-foreground hover:bg-hover hover:text-foreground',
  );

// Подсветка ТЕКУЩЕГО пункта в выпадающих списках крошек — мягкая заливка (как в Notion),
// а не просто жирный шрифт. data-[highlighted] (hover/keyboard) перекрывает её focus-bg'ом.
const CURRENT_DROPDOWN_ITEM_CLASS =
  'bg-foreground/[0.06] font-medium text-foreground dark:bg-white/[0.08]';

// Четвёртый сегмент крошек на ОТДЕЛЬНОЙ странице задачи: название текущей задачи +
// hover-дропдаун с недавно редактированными задачами того же проекта для быстрого
// перехода. На обычных страницах проекта не передаётся.
export type BreadcrumbTask = {
  taskId: string;
  title: string;
  // Недавно редактированные задачи проекта (уже отсортированы, обычно ≤8).
  recent: ReadonlyArray<{ id: string; title: string }>;
};

type Props = {
  projectId: string;
  projectName: string;
  projectIcon?: string | null;
  // Активный вид — определяет, какой сегмент «текущий» (жирный, без подсветки-ссылки).
  view: ProjectViewKey;
  // Сегмент задачи (только на странице отдельной задачи). Если задан — текущим
  // становится он, а сегмент проекта снова кликабельный.
  task?: BreadcrumbTask;
};

export function ProjectBreadcrumbs({
  projectId,
  projectName,
  projectIcon,
  view,
  task,
}: Props): React.ReactElement {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const allProjects = (projects ?? []).filter((p) => !p.isInbox);

  const projectsMenu = useHoverMenu();
  const viewsMenu = useHoverMenu();
  const taskMenu = useHoverMenu();
  const currentView = VIEWS.find((v) => v.key === view);

  return (
    <nav className="flex min-w-0 items-center gap-0.5 text-sm" aria-label="Хлебные крошки">
      {/* Сегмент «Проекты» — дропдаун со всеми проектами для быстрого перехода. */}
      <DropdownMenu open={projectsMenu.open} onOpenChange={projectsMenu.setOpen} modal={false}>
        <DropdownMenuTrigger
          className={segmentClass()}
          onMouseEnter={projectsMenu.openNow}
          onMouseLeave={projectsMenu.closeSoon}
        >
          <FolderOpen className="size-3.5 shrink-0" />
          <span>Проекты</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 w-56 overflow-y-auto"
          onMouseEnter={projectsMenu.openNow}
          onMouseLeave={projectsMenu.closeSoon}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel>Перейти к проекту</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allProjects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => navigate(`/projects/${p.id}`)}
              className={cn(p.id === projectId && CURRENT_DROPDOWN_ITEM_CLASS)}
            >
              <ProjectChip name={p.name} icon={p.icon} />
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />

      {/* Сегмент проекта — дропдаун с видами (Доска / Обзор / База знаний / …). */}
      <DropdownMenu open={viewsMenu.open} onOpenChange={viewsMenu.setOpen} modal={false}>
        <DropdownMenuTrigger
          className={cn(segmentClass(view === 'board' && !task), 'min-w-0')}
          onMouseEnter={viewsMenu.openNow}
          onMouseLeave={viewsMenu.closeSoon}
        >
          <ProjectChip name={projectName} icon={projectIcon} />
          {/* Длинное имя проекта обрезаем многоточием, чтобы крошки не растягивали хедер. */}
          <span className="min-w-0 max-w-[9rem] truncate sm:max-w-[14rem]">{projectName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-52"
          onMouseEnter={viewsMenu.openNow}
          onMouseLeave={viewsMenu.closeSoon}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel>Разделы проекта</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {VIEWS.map(({ key, label, Icon, path }) => (
            <DropdownMenuItem
              key={key}
              onSelect={() => navigate(path(projectId))}
              className={cn(key === view && CURRENT_DROPDOWN_ITEM_CLASS)}
            >
              <Icon />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Сегмент задачи — на отдельной странице задачи. Текущий (пилюля) + hover-дропдаун
          с недавними задачами проекта для быстрого перехода между ними. */}
      {task && (
        <>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
          <DropdownMenu open={taskMenu.open} onOpenChange={taskMenu.setOpen} modal={false}>
            <DropdownMenuTrigger
              className={cn(segmentClass(true), 'min-w-0')}
              onMouseEnter={taskMenu.openNow}
              onMouseLeave={taskMenu.closeSoon}
            >
              <span className="min-w-0 max-w-[7rem] truncate sm:max-w-[12rem]">{task.title}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-64 overflow-y-auto"
              onMouseEnter={taskMenu.openNow}
              onMouseLeave={taskMenu.closeSoon}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuLabel>Недавние задачи</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {task.recent.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Других задач нет</div>
              ) : (
                task.recent.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onSelect={() => navigate(`/projects/${projectId}/tasks/${t.id}`)}
                    className={cn('min-w-0', t.id === task.taskId && CURRENT_DROPDOWN_ITEM_CLASS)}
                  >
                    <span className="truncate">{t.title}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Третий сегмент — текущий вид (если это не «Доска», которая совпадает с проектом). */}
      {view !== 'board' && currentView && (
        <>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
          <span className={cn(segmentClass(true), 'pointer-events-none')}>
            <currentView.Icon className="size-3.5 shrink-0" />
            <span className="truncate">{currentView.label}</span>
          </span>
        </>
      )}
    </nav>
  );
}
