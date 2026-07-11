import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  Copy,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Table as TableIcon,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  BOARD_VIEW_TYPES,
  BOARD_VIEW_TYPE_LABELS,
  type BoardView,
  type BoardViewType,
} from '@/domain/project/BoardView';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { KanbanBoard } from '../KanbanBoard';
import { TableView } from './TableView';
import { ListView } from './ListView';
import { CalendarView } from './CalendarView';

export const VIEW_TYPE_ICONS: Record<BoardViewType, LucideIcon> = {
  kanban: LayoutGrid,
  table: TableIcon,
  list: List,
  calendar: Calendar,
};

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  onOpenAutomation?: () => void;
  // Full-bleed классы канбана (см. KanbanBoard) — остальные виды обычной ширины.
  bleedNegClass?: string;
  bleedPadClass?: string;
};

// id неявной дефолтной вкладки «Доска» (канбан). В БД не хранится, не переименовывается
// и не удаляется — это текущая доска проекта как есть.
const DEFAULT_VIEW_ID = 'default';

// === Вью доски проекта (Notion-style, план board-views-design) ===
// Строка вкладок над доской: «Доска» (неявный канбан) + пользовательские вью из БД + «+».
// Активная вью — localStorage пер-проект (устройство-локально). Повторный клик по активной
// пользовательской вкладке открывает меню (Переименовать/Дублировать/Удалить).
export function ProjectBoardViews({
  projectId,
  projectName,
  memberCount,
  onOpenAutomation,
  bleedNegClass = '',
  bleedPadClass = '',
}: Props): React.ReactElement {
  const { boardViewRepository } = useContainer();
  const storageKey = `pf:board-view:${projectId}`;
  const [views, setViews] = useState<BoardView[] | null>(null);
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? DEFAULT_VIEW_ID;
    } catch {
      return DEFAULT_VIEW_ID;
    }
  });
  const [renameTarget, setRenameTarget] = useState<BoardView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BoardView | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const refetch = useCallback(async (): Promise<void> => {
    try {
      setViews(await boardViewRepository.list(projectId));
    } catch {
      // Тихо: без списка вью остаётся дефолтная «Доска» — страница работоспособна.
      setViews((prev) => prev ?? []);
    }
  }, [boardViewRepository, projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Вью — shared-состояние проекта: ловим SSE «проект изменился» (кто-то добавил/удалил).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId !== projectId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 400);
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, onChanged);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(PROJECT_CHANGED_EVENT, onChanged);
    };
  }, [projectId, refetch]);

  const selectView = (id: string): void => {
    setActiveId(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* ignore */
    }
  };

  // Сохранённая вью удалена (нами или коллегой) → падаем на дефолтную «Доску».
  useEffect(() => {
    if (views === null || activeId === DEFAULT_VIEW_ID) return;
    if (!views.some((v) => v.id === activeId)) selectView(DEFAULT_VIEW_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, activeId]);

  const active = useMemo(
    () => (views ?? []).find((v) => v.id === activeId) ?? null,
    [views, activeId],
  );
  const activeType: BoardViewType = active?.type ?? 'kanban';

  const handleCreate = async (name: string, type: BoardViewType): Promise<void> => {
    try {
      const view = await boardViewRepository.create(projectId, name, type);
      setViews((prev) => [...(prev ?? []), view]);
      selectView(view.id);
      setNewOpen(false);
    } catch (e) {
      toast.error(`Не удалось создать вью: ${(e as Error).message}`);
    }
  };

  const handleRename = async (view: BoardView, name: string): Promise<void> => {
    try {
      const updated = await boardViewRepository.rename(projectId, view.id, name);
      setViews((prev) => (prev ?? []).map((v) => (v.id === view.id ? updated : v)));
      setRenameTarget(null);
    } catch (e) {
      toast.error(`Не удалось переименовать: ${(e as Error).message}`);
    }
  };

  const handleDuplicate = async (view: BoardView): Promise<void> => {
    try {
      const copy = await boardViewRepository.duplicate(projectId, view.id);
      setViews((prev) => [...(prev ?? []), copy]);
      selectView(copy.id);
    } catch (e) {
      toast.error(`Не удалось дублировать: ${(e as Error).message}`);
    }
  };

  const handleDelete = async (view: BoardView): Promise<void> => {
    try {
      await boardViewRepository.remove(projectId, view.id);
      setViews((prev) => (prev ?? []).filter((v) => v.id !== view.id));
      if (activeId === view.id) selectView(DEFAULT_VIEW_ID);
      setDeleteTarget(null);
    } catch (e) {
      toast.error(`Не удалось удалить: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Ряд вкладок вью — тихие текстовые табы в стиле Notion. */}
      <div className="flex items-center gap-0.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ViewTab
          icon={VIEW_TYPE_ICONS.kanban}
          name="Доска"
          active={activeId === DEFAULT_VIEW_ID}
          onSelect={() => selectView(DEFAULT_VIEW_ID)}
        />
        {(views ?? []).map((v) => (
          <ViewTab
            key={v.id}
            icon={VIEW_TYPE_ICONS[v.type]}
            name={v.name}
            active={activeId === v.id}
            onSelect={() => selectView(v.id)}
            menu={
              <>
                <DropdownMenuItem className="gap-2" onClick={() => setRenameTarget(v)}>
                  <Pencil className="size-4" />
                  Переименовать
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={() => void handleDuplicate(v)}>
                  <Copy className="size-4" />
                  Дублировать вью
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive"
                  onClick={() => setDeleteTarget(v)}
                >
                  <Trash2 className="size-4" />
                  Удалить вью
                </DropdownMenuItem>
              </>
            }
          />
        ))}
        <NewViewPopover open={newOpen} onOpenChange={setNewOpen} onCreate={handleCreate} />
      </div>

      {/* Активный вид. key по вью — смена вкладки пересоздаёт вид (свой useTasks/стейт). */}
      {activeId === DEFAULT_VIEW_ID || activeType === 'kanban' ? (
        <KanbanBoard
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
          onOpenAutomation={onOpenAutomation}
          bleedNegClass={bleedNegClass}
          bleedPadClass={bleedPadClass}
        />
      ) : activeType === 'table' ? (
        <TableView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
        />
      ) : activeType === 'list' ? (
        <ListView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
        />
      ) : (
        <CalendarView
          key={`${projectId}:${activeId}`}
          projectId={projectId}
          projectName={projectName}
          memberCount={memberCount}
        />
      )}

      {/* Переименование вью. */}
      <RenameViewDialog
        view={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => renameTarget && void handleRename(renameTarget, name)}
      />

      {/* Подтверждение удаления вью (задачи не трогаются — удаляется только представление). */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-xs gap-3 p-5">
          <DialogHeader>
            <DialogTitle className="text-base">Удалить вью?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            «{deleteTarget?.name}» будет удалена у всех участников. Задачи не пострадают.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
            >
              Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Вкладка вью: клик — выбрать; у АКТИВНОЙ пользовательской справа появляется шеврон-меню
// (Переименовать/Дублировать/Удалить). Меню НЕ на самой кнопке вкладки: Radix-триггер
// перехватывает pointerdown и глушит клик — вкладка переставала переключаться (баг ловился
// e2e: клик по неактивной вкладке открывал меню вместо выбора). У дефолтной «Доски» меню нет.
function ViewTab({
  icon: Icon,
  name,
  active,
  onSelect,
  menu,
}: {
  icon: LucideIcon;
  name: string;
  active: boolean;
  onSelect: () => void;
  menu?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center rounded-md transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'inline-flex items-center gap-1.5 py-1 pl-2 text-[13px] font-medium',
          active && menu ? 'pr-0.5' : 'pr-2',
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="max-w-[9rem] truncate">{name}</span>
      </button>
      {active && menu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Меню вью"
              title="Меню вью"
              className="grid h-full place-items-center rounded-r-md py-1 pl-0.5 pr-1.5 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// «+» → поповер создания вью: сетка типов (иконка+подпись) + имя. Имя по умолчанию —
// подпись типа; создание по кнопке или Enter в поле.
function NewViewPopover({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (name: string, type: BoardViewType) => Promise<void>;
}): React.ReactElement {
  const [type, setType] = useState<BoardViewType>('table');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const effectiveName = (touched && name.trim()) || BOARD_VIEW_TYPE_LABELS[type];

  useEffect(() => {
    if (!open) {
      setType('table');
      setName('');
      setTouched(false);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Новая вью"
          title="Новая вью"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="pb-2 text-xs font-medium text-muted-foreground">Новая вью</p>
        <div className="grid grid-cols-2 gap-1.5">
          {BOARD_VIEW_TYPES.map((t) => {
            const Icon = VIEW_TYPE_ICONS[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors',
                  type === t
                    ? 'border-primary/50 bg-primary/5 text-foreground ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {BOARD_VIEW_TYPE_LABELS[t]}
                {type === t && <Check className="ml-auto size-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
        <input
          value={touched ? name : ''}
          onChange={(e) => {
            setTouched(true);
            setName(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onCreate(effectiveName, type);
            }
          }}
          placeholder={BOARD_VIEW_TYPE_LABELS[type]}
          aria-label="Название вью"
          className="mt-2.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/30"
        />
        <Button size="sm" className="mt-2 w-full" onClick={() => void onCreate(effectiveName, type)}>
          Создать
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function RenameViewDialog({
  view,
  onClose,
  onSubmit,
}: {
  view: BoardView | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  useEffect(() => {
    setName(view?.name ?? '');
  }, [view]);
  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Dialog open={view !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">Переименовать вью</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={64}
          aria-label="Название вью"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/30"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit}>Сохранить</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
