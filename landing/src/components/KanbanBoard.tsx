/**
 * Интерактивная канбан-доска лендинга — визуально 1:1 с доской приложения ProjectsFlow.
 * Колонки (как в app): Черновики → Вручную → Воркер (Claude Opus) → Готово.
 * Карточка = текст задачи (без ID, как в проде) + цветной левый кант приоритета + мета.
 * Перетащи/нажми карточку — она идёт по колонкам. В «Воркере» AI берёт её в работу:
 * пульсирующая 🔴 точка + бейдж «В работе» (ровно как в приложении), затем → «Готово».
 * Есть авто-демо, когда доску не трогают. Уважает prefers-reduced-motion.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type ColId = 'backlog' | 'manual' | 'todo' | 'done';
type Priority = 'high' | 'medium' | 'low' | null;

interface Card {
  readonly id: string;
  readonly text: string;
  readonly priority: Priority;
  readonly checklist?: [number, number];
  readonly comments?: number;
}

type Board = Record<ColId, Card[]>;

// Колонки и их цвет-маркер — точь-в-точь как в приложении (statusLabels.ts / kanbanColors.ts).
const COLUMNS: readonly { id: ColId; title: string; color: string; subtitle?: string }[] = [
  { id: 'backlog', title: 'Черновики', color: 'gray' },
  { id: 'manual', title: 'Вручную', color: 'yellow' },
  { id: 'todo', title: 'Воркер', color: 'blue', subtitle: 'Claude Opus' },
  { id: 'done', title: 'Готово', color: 'green' },
];

// Прогрессия «шаг вперёд» — как ADVANCE_NEXT в app: Черновики→Вручную→Воркер→Готово.
const NEXT: Record<ColId, ColId | null> = {
  backlog: 'manual',
  manual: 'todo',
  todo: 'done',
  done: null,
};

const INITIAL: Board = {
  backlog: [
    { id: 'c1', text: 'Тёмная тема для дашборда', priority: 'low', checklist: [2, 5] },
    { id: 'c2', text: 'Экспорт отчёта в PDF', priority: null },
  ],
  manual: [{ id: 'c3', text: 'Текст для страницы оплаты', priority: 'medium', comments: 3 }],
  todo: [{ id: 'c4', text: 'Экран оплаты через СБП', priority: 'high' }],
  done: [
    { id: 'c5', text: 'Онбординг новых пользователей', priority: null },
    { id: 'c6', text: 'Импорт клиентов из CSV', priority: 'low' },
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

const PROGRESS_MS = 2800;

export default function KanbanBoard(): React.ReactElement {
  const [board, setBoard] = useState<Board>(INITIAL);
  const [overCol, setOverCol] = useState<ColId | null>(null);
  const [ghost, setGhost] = useState<{ card: Card; x: number; y: number } | null>(null);
  const [runId, setRunId] = useState<string | null>('c4'); // задача, над которой сейчас «работает» воркер

  const colEls = useRef<Map<ColId, HTMLElement | null>>(new Map());
  const boardRef = useRef(board);
  boardRef.current = board;

  const reduce = useRef(false);
  const lastTouch = useRef(0);

  const drag = useRef<{
    id: string;
    from: ColId;
    grabX: number;
    grabY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // «Воркер берёт задачу»: 🔴 пульс + «В работе», затем карточка уезжает в «Готово».
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

  // Таймер завершения работы над активной задачей.
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

  const hitColumn = (x: number, y: number): ColId | null => {
    for (const { id } of COLUMNS) {
      const el = colEls.current.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (!d.moved && dist < 6) return;
      d.moved = true;
      lastTouch.current = performance.now();
      const card = Object.values(boardRef.current)
        .flat()
        .find((k) => k.id === d.id) as Card | undefined;
      if (!card) return;
      setGhost({ card, x: e.clientX - d.grabX, y: e.clientY - d.grabY });
      setOverCol(hitColumn(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (d.moved) {
        const to = hitColumn(e.clientX, e.clientY);
        if (to) moveCard(d.id, to);
      } else {
        advance(d.id);
      }
      setGhost(null);
      setOverCol(null);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [moveCard, advance]);

  const onCardDown = (e: React.PointerEvent, card: Card, col: ColId) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = {
      id: card.id,
      from: col,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    lastTouch.current = performance.now();
  };

  // Авто-демо: если доску не трогают — двигаем задачи сами, чтобы «жила».
  useEffect(() => {
    if (reduce.current) return;
    const timer = window.setInterval(() => {
      if (drag.current || runId) return;
      if (performance.now() - lastTouch.current < 5000) return;
      const b = boardRef.current;
      if (b.manual.length > 0) moveCard(b.manual[b.manual.length - 1]!.id, 'todo');
      else if (b.backlog.length > 0) moveCard(b.backlog[b.backlog.length - 1]!.id, 'manual');
      else if (b.done.length >= 4) setBoard(INITIAL);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [moveCard, runId]);

  const renderCard = (card: Card, col: ColId): React.ReactElement => {
    const running = runId === card.id && col === 'todo';
    const isGhosted = ghost?.card.id === card.id;
    const canAdvance = NEXT[col] !== null;
    return (
      <div
        key={card.id}
        className={
          'kb2__card' +
          (card.priority ? ` kb2__card--p-${card.priority}` : '') +
          (col === 'todo' ? ' kb2__card--todo' : '') +
          (col === 'done' ? ' kb2__card--done' : '') +
          (isGhosted ? ' is-dragging' : '')
        }
        onPointerDown={(e) => onCardDown(e, card, col)}
        role={canAdvance ? 'button' : undefined}
        tabIndex={canAdvance ? 0 : undefined}
        aria-label={
          `Задача: ${card.text}, колонка «${COLUMNS.find((c) => c.id === col)?.title}»` +
          (canAdvance ? '. Enter — передать дальше' : ' — готово')
        }
        onKeyDown={
          canAdvance
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  advance(card.id);
                }
              }
            : undefined
        }
      >
        {running && <span className="kb2__live" aria-hidden="true" />}
        <p className="kb2__text">{card.text}</p>
        <div className="kb2__meta">
          {card.checklist && (
            <span className="kb2__m">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2 4.5l1.5 1.5L6 3.5M2 11l1.5 1.5L6 10M9 5h5M9 11.5h5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {card.checklist[0]}/{card.checklist[1]}
            </span>
          )}
          {card.comments != null && (
            <span className="kb2__m">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
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
      </div>
    );
  };

  return (
    <div className="kb2" aria-label="Демо канбан-доски ProjectsFlow">
      <div className="kb2__head">
        <span className="kb2__tl kb2__tl--r" />
        <span className="kb2__tl kb2__tl--y" />
        <span className="kb2__tl kb2__tl--g" />
        <span className="kb2__title">Мой проект · доска</span>
        <span className="kb2__branch">main</span>
      </div>

      <div className="kb2__cols">
        {COLUMNS.map((col) => {
          const cards = board[col.id];
          return (
            <div
              key={col.id}
              ref={(el) => {
                colEls.current.set(col.id, el);
              }}
              className={'kb2__col' + (overCol === col.id ? ' is-over' : '')}
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
                {cards.map((card) => renderCard(card, col.id))}
              </div>
            </div>
          );
        })}
      </div>

      {ghost && (
        <div className="kb2__ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <p className="kb2__text">{ghost.card.text}</p>
        </div>
      )}
    </div>
  );
}
