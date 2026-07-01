/**
 * Интерактивная канбан-доска — «единственная» на лендинге (герой, правая колонка).
 * Метафора продукта: задачу можно ПЕРЕТАЩИТЬ на колонку «Воркер» — AI-воркер «берёт её
 * в работу» (аватар оживает, бежит лог + прогресс), затем карточка сама уезжает в «Ревью»,
 * а оттуда по кнопке «Принять» — в «Готово». Плюс: клик по карточке = переход на след. колонку
 * (touch/keyboard-fallback), и ненавязчивое авто-демо, когда пользователь не трогает доску.
 *
 * Только на дизайн-токенах (см. tokens.css), стили — классы .kb-* в landing.css, поэтому
 * доска автоматически «темнеет» внутри [data-theme="dark"]-секции, если её туда поставить.
 * Уважает prefers-reduced-motion (без авто-демо и без анимации прогресса).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type ColId = 'ideas' | 'worker' | 'review' | 'done';

interface Card {
  readonly id: string;
  readonly title: string;
  readonly tag: string;
}

type Board = Record<ColId, Card[]>;

const COLUMNS: readonly { id: ColId; title: string }[] = [
  { id: 'ideas', title: 'Идеи' },
  { id: 'worker', title: 'Воркер' },
  { id: 'review', title: 'Ревью' },
  { id: 'done', title: 'Готово' },
];

const NEXT: Record<ColId, ColId | null> = {
  ideas: 'worker',
  worker: 'review',
  review: 'done',
  done: null,
};

const INITIAL: Board = {
  ideas: [
    { id: 'PF-214', title: 'Тёмная тема', tag: 'UI' },
    { id: 'PF-215', title: 'Экран оплаты', tag: 'BILLING' },
    { id: 'PF-216', title: 'Telegram-бот', tag: 'BOT' },
  ],
  worker: [],
  review: [{ id: 'PF-212', title: 'Импорт CSV', tag: 'DATA' }],
  done: [{ id: 'PF-208', title: 'Онбординг', tag: 'UX' }],
};

// Строки «лога воркера» — прокручиваются, пока идёт работа.
const WORKER_LOG = [
  'Читаю задачу…',
  'Пишу код…',
  'Гоняю тесты…',
  'Проверяю безопасность…',
  'Открываю PR…',
];

const clone = (b: Board): Board => ({
  ideas: [...b.ideas],
  worker: [...b.worker],
  review: [...b.review],
  done: [...b.done],
});

const colOf = (b: Board, id: string): ColId | null =>
  (Object.keys(b) as ColId[]).find((c) => b[c].some((k) => k.id === id)) ?? null;

const PROGRESS_MS = 2600;

export default function KanbanBoard(): React.ReactElement {
  const [board, setBoard] = useState<Board>(INITIAL);
  const [overCol, setOverCol] = useState<ColId | null>(null);
  const [ghost, setGhost] = useState<{ card: Card; x: number; y: number } | null>(null);
  const [run, setRun] = useState<{ id: string; pct: number; step: number } | null>(null);

  const colEls = useRef<Map<ColId, HTMLElement | null>>(new Map());
  const rootEl = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;

  const reduce = useRef(false);
  const lastTouch = useRef(0); // время последнего действия пользователя (пауза авто-демо)

  // Указатель-drag: мутабельное состояние в ref (window-листенеры читают его без ре-рендера).
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

  // --- «Воркер берёт задачу»: прогресс + лог, затем карточка уезжает в «Ревью». ----------
  const startWork = useCallback((id: string) => {
    if (reduce.current) {
      // Без анимации: сразу перекладываем в ревью.
      setBoard((b) => {
        const from = colOf(b, id);
        if (from !== 'worker') return b;
        const card = b.worker.find((k) => k.id === id);
        if (!card) return b;
        const nb = clone(b);
        nb.worker = nb.worker.filter((k) => k.id !== id);
        nb.review = [card, ...nb.review];
        return nb;
      });
      return;
    }
    setRun({ id, pct: 0, step: 0 });
  }, []);

  // Анимация прогресса активной задачи (rAF-таймер, устойчив к ре-рендерам).
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    let start = 0;
    let stepTimer = 0;

    const tick = (now: number) => {
      if (!start) start = now;
      const pct = Math.min(100, ((now - start) / PROGRESS_MS) * 100);
      setRun((r) => (r && r.id === run.id ? { ...r, pct } : r));
      if (pct < 100) {
        raf = requestAnimationFrame(tick);
      } else {
        // Готово: карточка едет из «Воркер» в «Ревью».
        setBoard((b) => {
          const card = b.worker.find((k) => k.id === run.id);
          if (!card) return b;
          const nb = clone(b);
          nb.worker = nb.worker.filter((k) => k.id !== run.id);
          nb.review = [card, ...nb.review];
          return nb;
        });
        setRun(null);
      }
    };
    raf = requestAnimationFrame(tick);
    // Прокрутка строк лога.
    stepTimer = window.setInterval(() => {
      setRun((r) => (r ? { ...r, step: (r.step + 1) % WORKER_LOG.length } : r));
    }, PROGRESS_MS / WORKER_LOG.length);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(stepTimer);
    };
  }, [run?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Перемещение карточки между колонками ---------------------------------------------
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
      if (to === 'worker') startWork(id);
    },
    [startWork],
  );

  // Клик по карточке = переход на следующую колонку (touch / keyboard fallback).
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

  // --- Pointer-drag: свободный перенос в любую колонку ----------------------------------
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
      if (!d.moved && dist < 6) return; // порог — отличаем клик от переноса
      d.moved = true;
      lastTouch.current = performance.now();
      const card =
        boardRef.current[d.from].find((k) => k.id === d.id) ??
        (Object.values(boardRef.current).flat().find((k) => k.id === d.id) as Card | undefined);
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
        advance(d.id); // не двигали — считаем кликом
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

  // --- Авто-демо: если пользователь не трогает доску — оживляем сами -----------------------
  useEffect(() => {
    if (reduce.current) return;
    const timer = window.setInterval(() => {
      if (drag.current || run) return;
      if (performance.now() - lastTouch.current < 5200) return; // недавно трогали — не мешаем
      const b = boardRef.current;
      if (b.ideas.length > 0) {
        // Берём нижнюю идею в работу.
        moveCard(b.ideas[b.ideas.length - 1]!.id, 'worker');
      } else if (b.review.length > 0) {
        // Разгружаем ревью в готово.
        moveCard(b.review[b.review.length - 1]!.id, 'done');
      } else {
        // Всё в «Готово» — мягкий сброс демо к началу.
        setBoard(INITIAL);
      }
    }, 2600);
    return () => window.clearInterval(timer);
  }, [moveCard, run]);

  return (
    <div className="kb" ref={rootEl} aria-label="Демо канбан-доски ProjectsFlow">
      <div className="kb__head">
        <span className="kb__dot kb__dot--r" />
        <span className="kb__dot kb__dot--y" />
        <span className="kb__dot kb__dot--g" />
        <span className="kb__title">Мой проект · доска</span>
        <span className="kb__live">
          <i className="kb__pulse" /> AI на связи
        </span>
      </div>

      <div className="kb__cols">
        {COLUMNS.map((col) => {
          const cards = board[col.id];
          const isOver = overCol === col.id;
          return (
            <div
              key={col.id}
              ref={(el) => {
                colEls.current.set(col.id, el);
              }}
              className={
                'kb__col' +
                (col.id === 'worker' ? ' kb__col--worker' : '') +
                (isOver ? ' is-over' : '')
              }
              data-col={col.id}
            >
              <div className="kb__colh">
                <span>{col.title}</span>
                <span className="kb__count">{cards.length}</span>
              </div>

              <div className="kb__list">
                {col.id === 'worker' && cards.length === 0 && !run && (
                  <div className="kb__drop">Перетащи задачу сюда →</div>
                )}

                {cards.map((card) => {
                  const isRunning = run?.id === card.id && col.id === 'worker';
                  const isGhosted = ghost?.card.id === card.id;
                  const canAdvance = NEXT[col.id] !== null;
                  return (
                    <div
                      key={card.id}
                      className={
                        'kb__card' +
                        (isRunning ? ' kb__card--running' : '') +
                        (isGhosted ? ' is-dragging' : '') +
                        (col.id === 'done' ? ' kb__card--done' : '')
                      }
                      onPointerDown={(e) => onCardDown(e, card, col.id)}
                      role={canAdvance ? 'button' : undefined}
                      tabIndex={canAdvance ? 0 : undefined}
                      aria-label={
                        `Задача ${card.id}: ${card.title}, колонка «${col.title}»` +
                        (canAdvance ? '. Enter — передвинуть дальше' : ' — готово')
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
                      <div className="kb__card-top">
                        <span className="kb__id">{card.id}</span>
                        <span className="kb__tag">{card.tag}</span>
                      </div>
                      <div className="kb__card-title">
                        {col.id === 'done' && (
                          <svg viewBox="0 0 20 20" className="kb__check" aria-hidden="true">
                            <path
                              d="M4 10.5l4 4 8-9"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                        {card.title}
                      </div>

                      {isRunning && (
                        <div className="kb__work">
                          <div className="kb__worker">
                            <span className="kb__avatar" aria-hidden="true">
                              <span className="kb__avatar-core" />
                            </span>
                            <span className="kb__worker-log">{WORKER_LOG[run.step]}</span>
                          </div>
                          <div className="kb__bar">
                            <span style={{ width: `${run.pct}%` }} />
                          </div>
                        </div>
                      )}

                      {col.id === 'review' && (
                        <button
                          type="button"
                          className="kb__accept"
                          aria-label={`Принять задачу ${card.id}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            lastTouch.current = performance.now();
                            moveCard(card.id, 'done');
                          }}
                        >
                          ✓ Принять
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {ghost && (
        <div className="kb__ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <div className="kb__card-top">
            <span className="kb__id">{ghost.card.id}</span>
            <span className="kb__tag">{ghost.card.tag}</span>
          </div>
          <div className="kb__card-title">{ghost.card.title}</div>
        </div>
      )}
    </div>
  );
}
