import { useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArchiveRestore,
  BookOpen,
  Bot,
  Download,
  Eye,
  EyeOff,
  Globe,
  History,
  Link as LinkIcon,
  LayoutGrid,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useTaskHiding, setTaskHiding } from '@/presentation/components/tasks/taskHidingSetting';
import {
  useProjectBannersHidden,
  setProjectBannersHidden,
} from './projectBannersSetting';
import type { Project } from '@/domain/project/Project';
import { taskTitle } from '@/presentation/components/tasks/views/viewShared';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { useContainer } from '@/infrastructure/di/container';
import { ProjectVersionsDialog } from './ProjectVersionsDialog';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { trackProjectAction } from '@/lib/productAnalytics';

type Props = {
  project: Project;
  financeVisible: boolean;
  monitoringVisible: boolean;
  monitoringAlerts: number;
  onOpenAutomation: () => void;
  onOpenTaskFromHistory?: () => void;
  compact?: boolean;
  mode?: 'tasks' | 'studio';
};

type Action = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  badge?: number;
  destructive?: boolean;
  section: number;
};

// Меню «⋯» страницы проекта — копия Notion top-right actions: поиск «Search actions…»
// сверху (фильтрует пункты), секции с иконками, архив/удаление/экспорт, футер с датой.
export function ProjectActionsMenu({
  project,
  financeVisible,
  monitoringVisible,
  monitoringAlerts,
  onOpenAutomation,
  onOpenTaskFromHistory,
  compact = false,
  mode = 'tasks',
}: Props): React.ReactElement {
  const navigate = useNavigate();
  const { projectRepository, taskRepository } = useContainer();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const taskHiding = useTaskHiding();
  const bannersHidden = useProjectBannersHidden();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'archive' | 'delete' | 'export' | null>(null);
  const projectId = project.id;
  const isOwner = project.role === 'owner';
  const canEdit = isOwner || project.role === 'editor';
  // Зеркало условия рендера в TasksPage: онбординг GitHub появляется только у
  // не-inbox проектов и только при праве редактирования.
  const showGithubBanner = canEdit && !project.isInbox;

  const copyLink = (): void => {
    void navigator.clipboard
      .writeText(`${window.location.origin}/projects/${projectId}`)
      .then(() => toast.success('Ссылка на проект скопирована'))
      .catch(() => toast.error('Не удалось скопировать ссылку'));
  };

  // Экспорт задач в CSV (Notion Export): название;статус;приоритет;срок;создана.
  const exportCsv = async (): Promise<void> => {
    if (busyAction) return;
    setBusyAction('export');
    try {
      const tasks = await taskRepository.list(projectId);
      const esc = (s: string): string => `"${s.replaceAll('"', '""')}"`;
      const lines = [
        'Название;Статус;Приоритет;Срок;Создана',
        ...tasks.map((t) =>
          [
            esc(taskTitle(t)),
            esc(STATUS_LABEL[t.status] ?? t.status),
            esc(t.priority ? PRIORITY_META[t.priority].label : ''),
            esc(t.deadline ?? ''),
            esc(t.createdAt.toISOString().slice(0, 10)),
          ].join(';'),
        ),
      ];
      // BOM — чтобы Excel открыл кириллицу в UTF-8 корректно.
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Экспортировано задач: ${tasks.length}`);
    } catch (e) {
      toast.error(actionErrorMessage(e, 'Не удалось экспортировать проект'));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleArchive = async (): Promise<void> => {
    if (busyAction) return;
    const next = project.status === 'archived' ? 'active' : 'archived';
    const startedAt = performance.now();
    setBusyAction('archive');
    try {
      await projectRepository.update(projectId, { status: next });
      toast.success(next === 'archived' ? 'Проект в архиве' : 'Проект возвращён из архива');
      trackProjectAction({ projectId, action: 'archive_project', result: 'success', startedAt });
    } catch (error) {
      toast.error(actionErrorMessage(error));
      trackProjectAction({ projectId, action: 'archive_project', result: 'failure', startedAt });
    } finally {
      setBusyAction(null);
    }
  };

  const deleteProject = async (): Promise<void> => {
    if (busyAction) return;
    setBusyAction('delete');
    const startedAt = performance.now();
    trackProjectAction({ projectId, action: 'delete_project', result: 'started' });
    try {
      await projectRepository.delete(projectId);
      trackProjectAction({ projectId, action: 'delete_project', result: 'success', startedAt });
      toast.success('Проект удалён');
      navigate('/');
    } catch (error) {
      trackProjectAction({ projectId, action: 'delete_project', result: 'failure', startedAt });
      toast.error(actionErrorMessage(error, 'Не удалось удалить проект'));
      setBusyAction(null);
    }
  };

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];
    // Переход в Студию из режима задач живёт в тулбаре доски отдельной кнопкой — дублировать
    // его здесь незачем. Обратный переход остаётся в меню: в Студии тулбара доски нет, и
    // убрать отсюда «Открыть задачи» значило бы запереть пользователя в Студии.
    if (mode !== 'tasks')
      list.push({
        key: 'project-mode',
        label: 'Открыть задачи',
        icon: LayoutGrid,
        onSelect: () => navigate(`/projects/${projectId}`),
        section: 0,
      });
    list.push({ key: 'link', label: 'Скопировать ссылку', icon: LinkIcon, onSelect: copyLink, section: 0 });
    if (financeVisible)
      list.push({
        key: 'finance',
        label: 'Финансы',
        icon: Wallet,
        onSelect: () => navigate(`/projects/${projectId}/finance`),
        section: 1,
      });
    list.push(
      {
        key: 'automation',
        label: 'Автоматизация',
        icon: Bot,
        onSelect: onOpenAutomation,
        section: 1,
      },
      {
        key: 'kb',
        label: 'База знаний',
        icon: BookOpen,
        onSelect: () => navigate(`/projects/${projectId}/kb`),
        section: 1,
      },
    );
    if (monitoringVisible)
      list.push({
        key: 'monitoring',
        label: 'Мониторинг',
        icon: Activity,
        badge: monitoringAlerts,
        onSelect: () => navigate(`/projects/${projectId}/monitoring`),
        section: 1,
      });
    list.push({
      key: 'versions',
      label: 'История версий',
      icon: History,
      onSelect: () => setVersionsOpen(true),
      section: 1,
    });
    list.push({
      key: 'settings',
      label: 'Настройки',
      icon: Settings,
      onSelect: () => navigate(`/projects/${projectId}/overview`),
      section: 1,
    });
    list.push({
      key: 'export',
      label: 'Экспорт (CSV)',
      icon: Download,
      onSelect: () => void exportCsv(),
      section: 2,
    });
    if (canEdit && !project.isInbox)
      list.push({
        key: 'archive',
        label: project.status === 'archived' ? 'Вернуть из архива' : 'Архивировать',
        icon: project.status === 'archived' ? ArchiveRestore : Archive,
        onSelect: () => void toggleArchive(),
        section: 3,
      });
    if (isOwner && !project.isInbox)
      list.push({
        key: 'delete',
        label: 'Удалить проект',
        icon: Trash2,
        destructive: true,
        onSelect: () => setConfirmDelete(true),
        section: 3,
      });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, financeVisible, monitoringVisible, monitoringAlerts, canEdit, isOwner, mode]);

  const q = query.trim().toLowerCase();
  const filtered = q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions;

  const created = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(project.createdAt);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              // Иконочные кнопки шапки в Notion — 28×28. Compact-ветка (мобильная,
              // под палец) остаётся крупной: ужимать touch-target нельзя.
              compact ? 'size-10 sm:size-9' : 'size-7',
              'text-muted-foreground hover:text-foreground',
            )}
            disabled={busyAction !== null}
            aria-label="Ещё"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-72 p-1.5"
          onOpenAutoFocus={(e) => {
            // На ТАЧ-устройствах не переводим фокус в поле поиска при открытии — иначе сразу
            // всплывает экранная клавиатура. На десктопе (мышь) автофокус оставляем (быстрый ввод).
            if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
              e.preventDefault();
            }
          }}
        >
          {/* Поиск действий (Notion Search actions…). */}
          <div className="relative px-0.5 pb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-[9px] size-3.5 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered.length > 0) {
                  setOpen(false);
                  filtered[0]!.onSelect();
                }
              }}
              placeholder="Поиск действий…"
              aria-label="Поиск действий"
              className="h-7 w-full rounded-md bg-accent/60 pl-7 pr-2 text-xs outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2"
            />
          </div>
          {/* Глобальный тумблер «Скрывать лишние задачи» (на весь сайт). Выкл (дефолт) —
              канбаны показывают ВСЕ задачи сразу, без «Показать ещё». */}
          {!query && (
            <label className="mb-1 flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-accent/60">
              <EyeOff className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">Скрывать лишние задачи</span>
              <Switch checked={taskHiding} onCheckedChange={setTaskHiding} />
            </label>
          )}
          {/* Тумблер «Скрыть плашки» — только на странице задач (только там живёт
              #pf-sticky-banners). При наведении сбоку всплывает предпросмотр того,
              что именно скрывается. */}
          {!query && mode === 'tasks' && (
            <BannersHidingRow
              hidden={bannersHidden}
              onToggle={() => setProjectBannersHidden(!bannersHidden)}
              showGithubPreview={showGithubBanner}
            />
          )}
          <div className="max-h-96 overflow-y-auto">
            {filtered.map((a, i) => {
              const prev = filtered[i - 1];
              const Icon = a.icon;
              return (
                <div key={a.key}>
                  {prev && prev.section !== a.section && <div className="my-1 border-t" />}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      a.onSelect();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60',
                      a.destructive && 'text-destructive hover:text-destructive',
                    )}
                  >
                    <Icon className={cn('size-4', a.destructive ? '' : 'text-muted-foreground')} />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {a.badge !== undefined && a.badge > 0 && (
                      <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">
                        {a.badge}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                Ничего не найдено
              </p>
            )}
          </div>
          {/* Футер (Notion Last edited by …): дата создания проекта + маркер сборки
              (диагностика «у меня старая версия» без консоли). */}
          <div className="mt-1 flex items-center justify-between gap-2 border-t px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground/70">
            <span>Создан {created}</span>
            <span className="font-mono text-muted-foreground/50">{__PF_BUILD__}</span>
          </div>
        </PopoverContent>
      </Popover>

      <ProjectVersionsDialog
        projectId={projectId}
        projectName={project.name}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        onOpenTask={(taskId) => {
          setVersionsOpen(false);
          onOpenTaskFromHistory?.();
          const search = new URLSearchParams(window.location.search);
          search.set('task', taskId);
          search.delete('done');
          navigate(`/projects/${projectId}?${search.toString()}`);
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-xs gap-3 p-5">
          <DialogHeader>
            <DialogTitle className="text-base">Удалить проект?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            «{project.name}» и все его задачи будут удалены безвозвратно у всех участников.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={busyAction === 'delete'}
              onClick={() => void deleteProject()}
            >
              {busyAction === 'delete' ? 'Удаляем…' : 'Удалить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Строка-тумблер «Скрыть плашки» / «Показать плашки» с предпросмотром по наведению.
//
// Предпросмотр — Radix Tooltip, а не абсолютно позиционированный блок внутри поповера:
// у PopoverContent есть overflow-y-auto (значит и overflow-x: auto), поэтому всё, что
// вылезает за его рамку, обрезалось бы. Tooltip рендерится в портал на уровне body,
// поэтому не обрезается, не перехватывает клики и не закрывает сам поповер (Radix
// закрывает поповер только по pointerdown/focus СНАРУЖИ, а мы лишь наводим мышь).
// Свой TooltipProvider — чтобы строка работала независимо от того, обёрнута ли
// вызывающая страница в провайдер.
function BannersHidingRow({
  hidden,
  onToggle,
  showGithubPreview,
}: {
  hidden: boolean;
  onToggle: () => void;
  showGithubPreview: boolean;
}): React.ReactElement {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={hidden}
            className="mb-1 flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60"
          >
            {hidden ? (
              <Eye className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <EyeOff className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {hidden ? 'Показать плашки' : 'Скрыть плашки'}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                hidden ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground/70',
              )}
            >
              {hidden ? 'скрыты' : 'видны'}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" align="start" className="w-64 p-2">
          <BannersPreview showGithub={showGithubPreview} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Миниатюры плашек: не настоящие компоненты (они тянут данные, диалоги и поллинг),
// а узнаваемые «обложки» — те же фоны/иконки/первая строка текста, что и в оригиналах.
// Цвета копируются из самих плашек вместе с их dark:-вариантами.
function BannersPreview({ showGithub }: { showGithub: boolean }): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <p className="px-0.5 text-[11px] font-medium text-muted-foreground">
        Плашки над доской проекта
      </p>
      {showGithub && (
        <div className="flex items-center gap-2 rounded-md border border-indigo-950/10 bg-[linear-gradient(105deg,#f5f7ff_0%,#f7f3ff_45%,#f0f9ff_100%)] px-2 py-1.5 dark:border-white/10 dark:bg-[linear-gradient(105deg,#171a2c_0%,#21192d_48%,#13232d_100%)]">
          <span className="grid size-5 shrink-0 place-items-center rounded bg-white shadow-sm ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
            <Sparkles className="size-3 text-violet-600 dark:text-violet-300" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-semibold text-foreground">
              Подключите код проекта
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              Онбординг GitHub и запуск проекта
            </span>
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-md border border-black/[0.05] bg-[#e8f3f9] px-2 py-1.5 dark:border-white/[0.06] dark:bg-[#1d2a31]">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-white/70 dark:bg-white/10">
          <Globe className="size-3 text-[#37352f] opacity-70 dark:text-blue-100" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold text-[#37352f] dark:text-blue-50">
            Результат опубликован
          </span>
          <span className="block truncate text-[10px] text-[#37352f]/60 dark:text-blue-100/60">
            Ссылка на опубликованный сайт
          </span>
        </span>
      </div>
      <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
        Настройка общая для всех проектов и сохраняется между сессиями.
      </p>
    </div>
  );
}
