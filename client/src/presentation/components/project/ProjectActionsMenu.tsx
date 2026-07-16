import { useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArchiveRestore,
  BookOpen,
  Bot,
  Download,
  EyeOff,
  History,
  Link as LinkIcon,
  MoreHorizontal,
  Search,
  Settings,
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
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useTaskHiding, setTaskHiding } from '@/presentation/components/tasks/taskHidingSetting';
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
}: Props): React.ReactElement {
  const navigate = useNavigate();
  const { projectRepository, taskRepository } = useContainer();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const taskHiding = useTaskHiding();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'archive' | 'delete' | 'export' | null>(null);
  const projectId = project.id;
  const isOwner = project.role === 'owner';
  const canEdit = isOwner || project.role === 'editor';

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
    const list: Action[] = [
      { key: 'link', label: 'Скопировать ссылку', icon: LinkIcon, onSelect: copyLink, section: 0 },
    ];
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
  }, [project, financeVisible, monitoringVisible, monitoringAlerts, canEdit, isOwner]);

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
              compact ? 'size-10 sm:size-9' : 'size-8',
              'text-muted-foreground hover:text-foreground',
            )}
            disabled={busyAction !== null}
            aria-label="Ещё"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          {/* Поиск действий (Notion Search actions…). */}
          <div className="relative px-0.5 pb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-[9px] size-3.5 text-muted-foreground/60" />
            <input
              autoFocus
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
