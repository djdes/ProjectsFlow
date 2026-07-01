/**
 * Интерактивная канбан-доска лендинга — визуально 1:1 с доской приложения ProjectsFlow,
 * а перетаскивание — на том же @dnd-kit, что и в проде: карточка плавно «поднимается»
 * (DragOverlay с лёгким наклоном), следует за курсором и мягко ложится в колонку.
 * Колонки: Черновики → Вручную → Воркер (Claude Opus) → Готово. Дропнул на «Воркер» —
 * AI берёт задачу в работу (🔴 + «В работе»), затем → «Готово». Клик = шаг вперёд
 * (тач/клавиатура). Авто-демо, пока доску не трогают. Уважает prefers-reduced-motion.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

// Центр поднятой карточки жёстко привязываем к курсору — чтобы она всегда была ПОД
// курсором, без смещений от transform-предков/скролл-контейнеров (как в приложении).
const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (draggingNodeRect && activatorEvent) {
    const coords = getEventCoordinates(activatorEvent);
    if (!coords) return transform;
    const offsetX = coords.x - draggingNodeRect.left;
    const offsetY = coords.y - draggingNodeRect.top;
    return {
      ...transform,
      x: transform.x + offsetX - draggingNodeRect.width / 2,
      y: transform.y + offsetY - draggingNodeRect.height / 2,
    };
  }
  return transform;
};

type ColId = 'backlog' | 'manual' | 'todo' | 'done';

interface Card {
  readonly id: string;
  readonly text: string;
  readonly priority: 1 | 2 | 3 | 4 | null; // 1=Срочно 2=Высокий 3=Средний 4=Низкий
  readonly checklist?: [number, number];
  readonly comments?: number;
}

type Board = Record<ColId, Card[]>;

const COLUMNS: readonly { id: ColId; title: string; color: string; subtitle?: string }[] = [
  { id: 'backlog', title: 'Черновики', color: 'gray' },
  { id: 'manual', title: 'Вручную', color: 'yellow' },
  { id: 'todo', title: 'Воркер', color: 'blue', subtitle: 'Claude Opus' },
  { id: 'done', title: 'Готово', color: 'green' },
];
const COL_TITLE: Record<ColId, string> = {
  backlog: 'Черновики',
  manual: 'Вручную',
  todo: 'Воркер',
  done: 'Готово',
};

const NEXT: Record<ColId, ColId | null> = { backlog: 'manual', manual: 'todo', todo: 'done', done: null };

const INITIAL: Board = {
  backlog: [
    { id: 'c1', text: 'Тёмная тема для дашборда', priority: 4, checklist: [2, 5] },
    { id: 'c2', text: 'Экспорт отчёта в PDF', priority: null },
  ],
  manual: [{ id: 'c3', text: 'Текст для страницы оплаты', priority: 3, comments: 3 }],
  todo: [{ id: 'c4', text: 'Экран оплаты через СБП', priority: 1 }],
  done: [
    { id: 'c5', text: 'Онбординг новых пользователей', priority: null },
    { id: 'c6', text: 'Импорт клиентов из CSV', priority: 4 },
  ],
};

const clone = (b: Board): Board => ({
  backlog: [...b.backlog],
  manual: [...b.manual],
  todo: [...b.todo],
  done: [...b.done],
});
const colOf = (b: Board, id: string): ColId | null =>
  (Object.keys(b) as ColId[]).find((c) => b[c].some((k) => k.id === id)) ?? null;
const findCard = (b: Board, id: string): Card | undefined =>
  Object.values(b).flat().find((k) => k.id === id);

const PROGRESS_MS = 2800;

// Внутренность карточки (переиспользуется в колонке и в DragOverlay).
function CardInner({ card, running }: { card: Card; running: boolean }): React.ReactElement {
  return (
    <>
      {running && <span className="kb2__live" aria-hidden="true" />}
      <p className="kb2__text">{card.text}</p>
      {(card.checklist || card.comments != null || running) && (
        <div className="kb2__meta">
          {card.checklist && (
            <span className="kb2__m">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 4.5l1.5 1.5L6 3.5M2 11l1.5 1.5L6 10M9 5h5M9 11.5h5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {card.checklist[0]}/{card.checklist[1]}
            </span>
          )}
          {card.comments != null && (
            <span className="kb2__m">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              {card.comments}
            </span>
          )}
          {running && (
            <span className="kb2__wip">
              <span className="kb2__wip-dot" aria-hidden="true" />
              В работе
            </span>
          )}
        </div>
      )}
    </>
  );
}

const cardClass = (card: Card, col: ColId, extra = ''): string =>
  'kb2__card' +
  (card.priority ? ` kb2__card--p${card.priority}` : '') +
  (col === 'todo' ? ' kb2__card--todo' : '') +
  (col === 'done' ? ' kb2__card--done' : '') +
  extra;

function DraggableCard({
  card,
  col,
  running,
  onAdvance,
}: {
  card: Card;
  col: ColId;
  running: boolean;
  onAdvance: (id: string) => void;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, data: { col } });
  const canAdvance = NEXT[col] !== null;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role={canAdvance ? 'button' : undefined}
      tabIndex={canAdvance ? 0 : undefined}
      aria-label={`Задача: ${card.text}, колонка «${COL_TITLE[col]}»${canAdvance ? '. Enter — передать дальше' : ' — готово'}`}
      onClick={() => canAdvance && onAdvance(card.id)}
      onKeyDown={
        canAdvance
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAdvance(card.id);
              }
            }
          : undefined
      }
      className={cardClass(card, col, isDragging ? ' is-dragging' : '')}
    >
      <CardInner card={card} running={running} />
    </div>
  );
}

function Column({
  col,
  cards,
  runId,
  onAdvance,
}: {
  col: (typeof COLUMNS)[number];
  cards: Card[];
  runId: string | null;
  onAdvance: (id: string) => void;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div
      ref={setNodeRef}
      className={'kb2__col' + (isOver ? ' is-over' : '')}
      data-col={col.id}
      data-color={col.color}
    >
      <div className="kb2__colh">
        <span className="kb2__coldot" data-color={col.color} />
        <span className="kb2__colname">
          {col.title}
          {col.subtitle && <span className="kb2__colsub">{col.subtitle}</span>}
        </span>
        <span className="kb2__count">{cards.length}</span>
      </div>
      <div className="kb2__list">
        {col.id === 'todo' && cards.length === 0 && (
          <div className="kb2__drop">Перетащи сюда — воркер возьмёт в работу</div>
        )}
        {cards.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            col={col.id}
            running={runId === card.id && col.id === 'todo'}
            onAdvance={onAdvance}
          />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard(): React.ReactElement {
  const [board, setBoard] = useState<Board>(INITIAL);
  const [runId, setRunId] = useState<string | null>('c4');
  const [activeId, setActiveId] = useState<string | null>(null);
  // Портал DragOverlay в body доступен только после маунта (на сервере document нет).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const boardRef = useRef(board);
  boardRef.current = board;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  const reduce = useRef(false);
  const lastTouch = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const startWork = useCallback((id: string) => {
    setRunId(id);
    if (reduce.current) {
      setBoard((b) => {
        if (colOf(b, id) !== 'todo') return b;
        const card = b.todo.find((k) => k.id === id);
        if (!card) return b;
        const nb = clone(b);
        nb.todo = nb.todo.filter((k) => k.id !== id);
        nb.done = [card, ...nb.done];
        return nb;
      });
      setRunId(null);
    }
  }, []);

  useEffect(() => {
    if (!runId || reduce.current) return;
    const t = window.setTimeout(() => {
      setBoard((b) => {
        const card = b.todo.find((k) => k.id === runId);
        if (!card) return b;
        const nb = clone(b);
        nb.todo = nb.todo.filter((k) => k.id !== runId);
        nb.done = [card, ...nb.done];
        return nb;
      });
      setRunId(null);
    }, PROGRESS_MS);
    return () => window.clearTimeout(t);
  }, [runId]);

  const moveCard = useCallback(
    (id: string, to: ColId) => {
      setBoard((b) => {
        const from = colOf(b, id);
        if (!from || from === to) return b;
        const card = b[from].find((k) => k.id === id);
        if (!card) return b;
        const nb = clone(b);
        nb[from] = nb[from].filter((k) => k.id !== id);
        nb[to] = [card, ...nb[to]];
        return nb;
      });
      if (to === 'todo') startWork(id);
    },
    [startWork],
  );

  const advance = useCallback(
    (id: string) => {
      lastTouch.current = performance.now();
      const from = colOf(boardRef.current, id);
      if (!from) return;
      const to = NEXT[from];
      if (to) moveCard(id, to);
    },
    [moveCard],
  );

  const onDragStart = (e: DragStartEvent): void => {
    setActiveId(String(e.active.id));
    lastTouch.current = performance.now();
  };
  const onDragEnd = (e: DragEndEvent): void => {
    setActiveId(null);
    lastTouch.current = performance.now();
    const over = e.over?.id;
    if (over) moveCard(String(e.active.id), over as ColId);
  };

  // Авто-демо: пока не трогают — двигаем задачи сами (не мешает активному drag).
  useEffect(() => {
    if (reduce.current) return;
    const timer = window.setInterval(() => {
      if (activeRef.current || runId) return;
      if (performance.now() - lastTouch.current < 5000) return;
      const b = boardRef.current;
      if (b.manual.length > 0) moveCard(b.manual[b.manual.length - 1]!.id, 'todo');
      else if (b.backlog.length > 0) moveCard(b.backlog[b.backlog.length - 1]!.id, 'manual');
      else if (b.done.length >= 4) setBoard(INITIAL);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [moveCard, runId]);

  const activeCard = activeId ? findCard(board, activeId) : undefined;
  const activeCol = activeId ? colOf(board, activeId) : null;

  return (
    <div className="kb2" aria-label="Демо канбан-доски ProjectsFlow">
      <div className="kb2__head">
        <span className="kb2__tl kb2__tl--r" />
        <span className="kb2__tl kb2__tl--y" />
        <span className="kb2__tl kb2__tl--g" />
        <span className="kb2__title">Мой проект · доска</span>
        <span className="kb2__branch">main</span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="kb2__cols">
          {COLUMNS.map((col) => (
            <Column key={col.id} col={col} cards={board[col.id]} runId={runId} onAdvance={advance} />
          ))}
        </div>
        {/* Портал в body: карточка «отрывается» от доски и свободно летит за курсором по
            всей странице — .kb2 overflow:hidden и transform-предки героя больше не обрезают. */}
        {mounted &&
          createPortal(
            <DragOverlay dropAnimation={null} zIndex={9999} modifiers={[snapCenterToCursor]}>
              {activeCard && activeCol ? (
                <div className={cardClass(activeCard, activeCol, ' kb2__card--overlay')}>
                  <CardInner card={activeCard} running={false} />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
    </div>
  );
}
