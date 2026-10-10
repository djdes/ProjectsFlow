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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
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
import { hasOwnerRights } from '@/domain/project/ProjectMembership';

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
  const bannersHidden = useProjectBannersHidden();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'archive' | 'delete' | 'export' | null>(null);
  const projectId = project.id;
  const isOwner = hasOwnerRights(project.role);
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
          <div className="relative px-0.5 pbe-2 md:pbe-1.5">
            <Search className="pointer-events-none absolute start-3 inset-bs-[22px] size-4 -translate-y-1/2 text-muted-foreground/60 md:start-2.5 md:inset-bs-3.5 md:size-3.5" />
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
              className="h-11 w-full rounded-lg border border-border/70 bg-panel ps-9 pe-3 text-sm outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2 md:h-7 md:rounded-md md:border-0 md:ps-7 md:pe-2 md:text-xs"
            />
          </div>
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
          <div className="md:max-h-96 md:overflow-y-auto">
            {filtered.map((a, i) => {
              const prev = filtered[i - 1];
              const Icon = a.icon;
              return (
                <div key={a.key}>
                  {prev && prev.section !== a.section && <div className="my-1 border-bs" />}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      a.onSelect();
                    }}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-start text-sm transition-colors hover:bg-hover md:min-h-0 md:rounded-md md:py-1.5',
                      a.destructive && 'text-destructive hover:text-destructive',
                    )}
                  >
                    <Icon className={cn('size-4', a.destructive ? '' : 'text-muted-foreground')} />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {a.badge !== undefined && a.badge > 0 && (
                      <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] tabular-nums font-semibold leading-4 text-destructive-foreground">
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
          <div className="mbs-1 flex items-center justify-between gap-2 border-bs px-2 pbe-0.5 pbs-1.5 text-2xs text-muted-foreground/70">
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
          <div className="flex justify-end gap-2 pbs-1">
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
            className="mbe-1 flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-start text-sm transition-colors hover:bg-hover"
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
                'shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium',
                hidden ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-muted-foreground/70',
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
// Цвета — те же токены, что у самих плашек (превью живёт в тултипе на поверхности меню).
function BannersPreview({ showGithub }: { showGithub: boolean }): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <p className="px-0.5 text-2xs font-medium text-muted-foreground">
        Плашки над доской проекта
      </p>
      {showGithub && (
        <div className="flex items-center gap-2 rounded-md border border-primary/10 bg-primary/[0.04] px-2 py-1.5">
          <span className="grid size-5 shrink-0 place-items-center rounded bg-raised shadow-card">
            <Sparkles className="size-3 text-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-2xs font-semibold text-foreground">
              Подключите код проекта
            </span>
            <span className="block truncate text-2xs text-muted-foreground">
              Онбординг GitHub и запуск проекта
            </span>
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-md border border-border bg-primary-soft px-2 py-1.5">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-raised/70">
          <Globe className="size-3 text-foreground opacity-70" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-2xs font-semibold text-foreground">
            Результат опубликован
          </span>
          <span className="block truncate text-2xs text-foreground/60">
            Ссылка на опубликованный сайт
          </span>
        </span>
      </div>
      <p className="px-0.5 text-2xs leading-snug text-muted-foreground">
        Настройка общая для всех проектов и сохраняется между сессиями.
      </p>
    </div>
  );
}
