// Окно «ещё…» (Notion "N more..."): поиск по вью, полный список с drag-reorder
// (⋮⋮), «…»-меню у каждого пункта при hover и «+ Новое отображение» внизу (drill-down
// «Начать с нуля»). Ручной absolute-попап (TabRenamePopup-паттерн): Radix-меню
// не дружит с dnd и вложенными меню.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MoreHorizontal, Plus, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { BoardView, BoardViewType } from '@/domain/project/BoardView';
import { BOARD_VIEW_TYPES, BOARD_VIEW_TYPE_LABELS } from '@/domain/project/BoardView';
import { DropdownEntries, type MenuEntry } from './menuEntries';
import { VIEW_TYPE_ICONS, ViewIconGlyph, type ViewIconLike } from './ProjectBoardViews';

type Props = {
  views: BoardView[];
  boardName: string;
  activeId: string;
  defaultViewId: string;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  menuFor: (v: BoardView) => MenuEntry[];
  boardMenu: MenuEntry[];
  // Иконка отображения: кастомное эмодзи из config или иконка типа.
  iconFor?: (v: BoardView) => ViewIconLike;
  onCreate: (type: BoardViewType) => void;
  label: string;
  canManage?: boolean;
};

// Ряд вью в списке: drag за ⋮⋮, клик — переключение, «…» при hover — меню вью.
function ViewRow({
  id,
  icon,
  name,
  active,
  menu,
  onSelect,
  draggable,
  canManage,
}: {
  id: string;
  icon: ViewIconLike;
  name: string;
  active: boolean;
  menu: MenuEntry[];
  onSelect: () => void;
  draggable: boolean;
  canManage: boolean;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group/vrow flex items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-accent/60',
        active && 'bg-accent/60',
        isDragging && 'z-10 opacity-70',
      )}
    >
      <button
        type="button"
        aria-label="Перетащить вью"
        {...attributes}
        {...listeners}
        className={cn(
          'grid size-5 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/50 transition-opacity hover:bg-accent hover:text-foreground',
          !draggable && 'invisible',
        )}
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"
      >
        <ViewIconGlyph icon={icon} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </button>
      {canManage && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Меню вью «${name}»`}
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/vrow:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="min-w-[12rem]">
          <DropdownEntries entries={menu} />
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
  );
}

export function ViewsOverflowMenu({
  views,
  boardName,
  activeId,
  defaultViewId,
  onSelect,
  onReorder,
  menuFor,
  boardMenu,
  iconFor,
  onCreate,
  label,
  canManage = true,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Drill-down «Начать с нуля» по кнопке «+ Новое отображение» (Notion New view).
  const [creating, setCreating] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // Попап — fixed-портал в body: строка вкладок имеет overflow-x-auto и обрезала бы
  // absolute-потомка. Координаты — от кнопки-триггера в момент открытия.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const toggleOpen = (): void => {
    if (!open) {
      const r = rootRef.current?.getBoundingClientRect();
      setPos(r ? { left: Math.min(r.left, window.innerWidth - 300), top: r.bottom + 4 } : null);
    }
    setOpen((o) => !o);
  };

  // Собственный outside-click с задержкой подписки — паттерн TabRenamePopup.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', close), 250);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCreating(false);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return views;
    return views.filter((v) => v.name.toLowerCase().includes(q));
  }, [views, query]);
  const boardVisible = !query.trim() || boardName.toLowerCase().includes(query.trim().toLowerCase());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = (e: DragEndEvent): void => {
    const activeIdD = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || activeIdD === overId) return;
    const ids = views.map((v) => v.id);
    const from = ids.indexOf(activeIdD);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, activeIdD);
    onReorder(next);
  };

  const BoardIcon = VIEW_TYPE_ICONS.kanban;
  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={toggleOpen}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
          open && 'bg-accent/60 text-foreground',
        )}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            style={!creating && pos ? { left: pos.left, top: pos.top } : undefined}
            className={cn(
              'fixed z-50 rounded-lg border bg-popover p-1.5 shadow-lg duration-100 animate-in fade-in zoom-in-95',
              // «Начать с нуля» — центрированное окно (Notion Start from scratch),
              // список вью — у кнопки-триггера.
              creating ? 'left-1/2 top-[38%] w-80 -translate-x-1/2 p-3' : 'w-72',
            )}
          >
          {creating ? (
            <>
              <p className="px-0.5 pb-2 text-sm font-medium">Начать с нуля</p>
              <div className="grid grid-cols-4 gap-1 pb-1">
                {BOARD_VIEW_TYPES.map((t) => {
                  const Icon = VIEW_TYPE_ICONS[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onCreate(t);
                      }}
                      className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Icon className="size-5" />
                      {BOARD_VIEW_TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="relative px-0.5 pb-1.5">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-[calc(50%+3px)] text-muted-foreground/60" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                  }}
                  placeholder="Поиск вью…"
                  aria-label="Поиск вью"
                  className="h-7 w-full rounded-md bg-accent/60 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60"
                />
              </div>
              <div className="max-h-72 overflow-y-auto">
                {boardVisible && (
                  <ViewRow
                    id={defaultViewId}
                    icon={BoardIcon}
                    name={boardName}
                    active={activeId === defaultViewId}
                    menu={boardMenu}
                    onSelect={() => {
                      setOpen(false);
                      onSelect(defaultViewId);
                    }}
                    draggable={false}
                    canManage={canManage}
                  />
                )}
                <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={filtered.map((v) => v.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {filtered.map((v) => (
                      <ViewRow
                        key={v.id}
                        id={v.id}
                        icon={iconFor ? iconFor(v) : VIEW_TYPE_ICONS[v.type]}
                        name={v.name}
                        active={activeId === v.id}
                        menu={menuFor(v)}
                        onSelect={() => {
                          setOpen(false);
                          onSelect(v.id);
                        }}
                        // Reorder только без поиска — иначе индексы фильтра врут.
                        draggable={canManage && !query.trim()}
                        canManage={canManage}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                {filtered.length === 0 && !boardVisible && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Ничего не найдено
                  </p>
                )}
              </div>
              {canManage && <div className="mt-1 border-t pt-1">
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  <Plus className="size-4" />
                  Новое отображение
                </button>
              </div>}
            </>
          )}
          </div>,
          document.body,
        )}
    </span>
  );
}
