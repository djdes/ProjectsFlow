import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  Inbox,
  Moon,
  Monitor,
  Plus,
  Search,
  Sun,
  User,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import type { TaskSearchResult } from '@/domain/task/TaskSearchResult';
import { useProjects } from '@/presentation/hooks/useProjects';
import { useAddTaskDialog } from '@/presentation/components/forms/AddTaskDialogProvider';
import { useTheme } from '@/presentation/components/theme/ThemeProvider';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import { defaultProjectIcon as FolderIcon } from '@/presentation/layout/projectIcons';

const DEBOUNCE_MS = 250;

// Единый элемент палитры: проект / действие / результат поиска по задачам.
type PaletteItem = {
  readonly key: string;
  readonly section: 'projects' | 'actions' | 'tasks';
  readonly label: string;
  readonly sub?: string;
  readonly icon: React.ReactNode;
  readonly run: () => void;
};

const SECTION_TITLE: Record<PaletteItem['section'], string> = {
  projects: 'Проекты',
  actions: 'Действия',
  tasks: 'Задачи',
};

// ⌘K — командная палитра: переключение проектов, быстрые действия (создать задачу,
// навигация, тема) + полнотекстовый поиск по задачам всех проектов (от 2 символов).
export function TaskSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { searchTasks } = useContainer();
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const { open: openAddTask } = useAddTaskDialog();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Сброс состояния при каждом открытии — палитра всегда стартует чистой.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      // Radix фокусит контент; даём ему кадр, затем фокусим input.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced-поиск задач. Гонки гасим флагом cancelled.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchTasks
        .execute(trimmed)
        .then((res) => {
          if (cancelled) return;
          setResults(res);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchTasks]);

  const close = (): void => onOpenChange(false);

  // Собираем единый список: проекты → действия → результаты поиска по задачам.
  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLocaleLowerCase('ru');
    const matches = (s: string): boolean => q.length === 0 || s.toLocaleLowerCase('ru').includes(q);

    const projectItems: PaletteItem[] = (projects ?? [])
      .filter((p) => !p.isInbox && matches(p.name))
      .slice(0, q.length === 0 ? 6 : 12)
      .map((p) => ({
        key: `project-${p.id}`,
        section: 'projects',
        label: p.name,
        icon: p.icon ? (
          <span className="text-sm leading-none" aria-hidden>{p.icon}</span>
        ) : (
          <FolderIcon className="size-4 text-muted-foreground" />
        ),
        run: () => {
          close();
          navigate(`/projects/${p.id}`);
        },
      }));

    const actionDefs: Array<Omit<PaletteItem, 'section' | 'key'> & { key: string }> = [
      {
        key: 'add-task',
        label: 'Создать задачу',
        icon: <Plus className="size-4 text-success" />,
        run: () => {
          close();
          openAddTask();
        },
      },
      {
        key: 'inbox',
        label: 'Входящие',
        icon: <Inbox className="size-4 text-muted-foreground" />,
        run: () => {
          close();
          navigate('/');
        },
      },
      {
        key: 'notifications',
        label: 'Уведомления',
        icon: <Bell className="size-4 text-muted-foreground" />,
        run: () => {
          close();
          navigate('/notifications');
        },
      },
      {
        key: 'monitoring',
        label: 'Мониторинг — все проекты',
        icon: <Activity className="size-4 text-muted-foreground" />,
        run: () => {
          close();
          navigate('/monitoring');
        },
      },
      {
        key: 'profile',
        label: 'Профиль',
        icon: <User className="size-4 text-muted-foreground" />,
        run: () => {
          close();
          navigate('/profile');
        },
      },
      {
        key: 'theme-light',
        label: 'Тема: светлая',
        icon: <Sun className="size-4 text-muted-foreground" />,
        run: () => {
          setTheme('light');
          close();
        },
      },
      {
        key: 'theme-dark',
        label: 'Тема: тёмная',
        icon: <Moon className="size-4 text-muted-foreground" />,
        run: () => {
          setTheme('dark');
          close();
        },
      },
      {
        key: 'theme-system',
        label: 'Тема: системная',
        icon: <Monitor className="size-4 text-muted-foreground" />,
        run: () => {
          setTheme('system');
          close();
        },
      },
    ];
    const actionItems: PaletteItem[] = actionDefs
      .filter((a) => matches(a.label))
      .map((a) => ({ ...a, section: 'actions' as const }));

    const taskItems: PaletteItem[] = results.map((r) => ({
      key: `task-${r.taskId}`,
      section: 'tasks',
      label: r.excerpt || '—',
      sub: `${r.projectName} · ${STATUS_LABEL[r.status]}`,
      icon: <Search className="size-4 text-muted-foreground" />,
      run: () => {
        close();
        navigate(`/projects/${r.projectId}`);
      },
    }));

    return [...projectItems, ...actionItems, ...taskItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, query, results]);

  // Активный индекс не должен выпадать за пределы при изменении списка.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  function onKeyDown(e: React.KeyboardEvent): void {
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[activeIndex]?.run();
    }
  }

  const trimmed = query.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Поиск и команды</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Проект, команда или поиск по задачам…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-96 overflow-y-auto py-1">
          {items.map((item, i) => {
            const sectionStart = i === 0 || items[i - 1]?.section !== item.section;
            return (
              <li key={item.key}>
                {sectionStart && (
                  <p className="px-4 pb-1 pt-2 text-xs font-medium text-muted-foreground/70">
                    {SECTION_TITLE[item.section]}
                  </p>
                )}
                <button
                  type="button"
                  onClick={item.run}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors',
                    i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className="grid size-5 shrink-0 place-items-center">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm">{item.label}</span>
                    {item.sub && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">{item.sub}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          {loading && <li className="px-4 py-3 text-sm text-muted-foreground">Поиск задач…</li>}
          {!loading && trimmed.length >= 2 && items.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">Ничего не найдено.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
