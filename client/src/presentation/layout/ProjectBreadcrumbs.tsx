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
// Каждый сегмент с иконкой, hover-подсветкой и кликом-дропдауном навигации:
// «Проекты» → переход к любому проекту; сегмент проекта → переключение между его видами.

export type ProjectViewKey = 'board' | 'overview' | 'kb' | 'monitoring' | 'finance';

type ViewDef = { key: ProjectViewKey; label: string; Icon: LucideIcon; path: (id: string) => string };

const VIEWS: readonly ViewDef[] = [
  { key: 'board', label: 'Доска задач', Icon: LayoutGrid, path: (id) => `/projects/${id}` },
  { key: 'overview', label: 'Обзор', Icon: Info, path: (id) => `/projects/${id}/overview` },
  { key: 'kb', label: 'База знаний', Icon: BookOpen, path: (id) => `/projects/${id}/kb` },
  { key: 'monitoring', label: 'Мониторинг', Icon: Activity, path: (id) => `/projects/${id}/monitoring` },
  { key: 'finance', label: 'Финансы', Icon: Wallet, path: (id) => `/projects/${id}/finance` },
];

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

// Общий вид сегмента-кнопки (триггер дропдауна).
const segmentClass = (current?: boolean): string =>
  cn(
    'flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-foreground/[0.06] dark:hover:bg-white/10',
    current ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
  );

type Props = {
  projectId: string;
  projectName: string;
  projectIcon?: string | null;
  // Активный вид — определяет, какой сегмент «текущий» (жирный, без подсветки-ссылки).
  view: ProjectViewKey;
};

export function ProjectBreadcrumbs({
  projectId,
  projectName,
  projectIcon,
  view,
}: Props): React.ReactElement {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const allProjects = (projects ?? []).filter((p) => !p.isInbox);

  const currentView = VIEWS.find((v) => v.key === view);

  return (
    <nav className="flex min-w-0 items-center gap-0.5 text-sm" aria-label="Хлебные крошки">
      {/* Сегмент «Проекты» — дропдаун со всеми проектами для быстрого перехода. */}
      <DropdownMenu>
        <DropdownMenuTrigger className={segmentClass()}>
          <FolderOpen className="size-3.5 shrink-0" />
          <span>Проекты</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
          <DropdownMenuLabel>Перейти к проекту</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allProjects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => navigate(`/projects/${p.id}`)}
              className={cn(p.id === projectId && 'font-medium')}
            >
              <ProjectChip name={p.name} icon={p.icon} />
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />

      {/* Сегмент проекта — дропдаун с видами (Доска / Обзор / База знаний / …). */}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(segmentClass(view === 'board'), 'min-w-0')}>
          <ProjectChip name={projectName} icon={projectIcon} />
          <span className="truncate">{projectName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Разделы проекта</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {VIEWS.map(({ key, label, Icon, path }) => (
            <DropdownMenuItem
              key={key}
              onSelect={() => navigate(path(projectId))}
              className={cn(key === view && 'font-medium text-foreground')}
            >
              <Icon />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

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
