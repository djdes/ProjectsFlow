// «Жидкий» индикатор выбранного пункта: подложка перетекает от пункта к пункту.
// Перенос движка из приложения (client/src/lib/liquidIndicator.ts): каждый край — своя пружина,
// передний по ходу движения край жёсткий и убегает вперёд, задний мягкий и догоняет, поэтому
// подложка вытягивается к цели и стягивается на месте. Ось растяжения — та, вдоль которой
// идёт переход (вбок для ряда пилюль, вниз/вверх для столбца карточек). Новая цель на ходу
// подхватывается из текущего положения и скорости. Под reduced-motion — без движения.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export type IndicatorBox = { left: number; top: number; width: number; height: number };

type Axis = { pos: number; vel: number; target: number };
type SpringParams = { stiffness: number; damping: number };

// Затухание 0.78 — перелёт ~2%, «чуть-чуть», не пружинка.
const LEAD: SpringParams = { stiffness: 640, damping: 0.78 };
const TRAIL: SpringParams = { stiffness: 230, damping: 0.94 };
const CROSS: SpringParams = { stiffness: 520, damping: 0.92 };
const STEP = 1 / 240;
const MAX_FRAME = 1 / 20;
const REST_POS = 0.08;
const REST_VEL = 0.5;

export function motionReduced(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stepAxis(axis: Axis, { stiffness, damping }: SpringParams, dt: number): void {
  const c = 2 * damping * Math.sqrt(stiffness);
  const acceleration = -stiffness * (axis.pos - axis.target) - c * axis.vel;
  axis.vel += acceleration * dt;
  axis.pos += axis.vel * dt;
}

const atRest = (axis: Axis): boolean => Math.abs(axis.pos - axis.target) < REST_POS && Math.abs(axis.vel) < REST_VEL;

export class LiquidIndicator {
  private readonly left: Axis = { pos: 0, vel: 0, target: 0 };
  private readonly right: Axis = { pos: 0, vel: 0, target: 0 };
  private readonly top: Axis = { pos: 0, vel: 0, target: 0 };
  private readonly bottom: Axis = { pos: 0, vel: 0, target: 0 };
  private placed = false;
  private vertical = false;
  private forward = true;
  private frame = 0;
  private last = 0;
  private followAt = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly onFrame?: (box: IndicatorBox) => void,
  ) {}

  get box(): IndicatorBox | null {
    if (!this.placed) return null;
    return { left: this.left.pos, top: this.top.pos, width: this.right.pos - this.left.pos, height: this.bottom.pos - this.top.pos };
  }

  get moving(): boolean {
    return this.frame !== 0;
  }

  /** Встать на место без движения. */
  jump(box: IndicatorBox): void {
    this.stop();
    this.set(box, true);
    this.placed = true;
    this.paint();
  }

  /** Перетечь к новой цели пружинами из текущего положения и скорости. */
  springTo(box: IndicatorBox): void {
    if (!this.placed || motionReduced()) {
      this.jump(box);
      return;
    }
    const dx = box.left + box.width / 2 - (this.left.pos + this.right.pos) / 2;
    const dy = box.top + box.height / 2 - (this.top.pos + this.bottom.pos) / 2;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.vertical = Math.abs(dy) > Math.abs(dx);
      this.forward = this.vertical ? dy > 0 : dx > 0;
    }
    this.left.target = box.left;
    this.right.target = box.left + box.width;
    this.top.target = box.top;
    this.bottom.target = box.top + box.height;
    this.start();
  }

  /** Прямое ведение пальцем: без пружин, скорость запоминается для отпускания. */
  follow(box: IndicatorBox): void {
    const now = performance.now();
    const dt = this.followAt ? Math.max(1, now - this.followAt) / 1000 : 0;
    this.followAt = now;
    this.stop();
    const values: [Axis, number][] = [
      [this.left, box.left],
      [this.right, box.left + box.width],
      [this.top, box.top],
      [this.bottom, box.top + box.height],
    ];
    for (const [axis, value] of values) {
      axis.vel = dt > 0 && this.placed ? (value - axis.pos) / dt : 0;
      axis.pos = value;
      axis.target = value;
    }
    this.placed = true;
    this.paint();
  }

  /** Отпущен — дальше пружины к цели с накопленной скоростью. */
  release(box: IndicatorBox): void {
    this.followAt = 0;
    this.springTo(box);
  }

  destroy(): void {
    this.stop();
  }

  private set(box: IndicatorBox, resetVelocity: boolean): void {
    const values: [Axis, number][] = [
      [this.left, box.left],
      [this.right, box.left + box.width],
      [this.top, box.top],
      [this.bottom, box.top + box.height],
    ];
    for (const [axis, value] of values) {
      axis.pos = value;
      axis.target = value;
      if (resetVelocity) axis.vel = 0;
    }
  }

  private start(): void {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private readonly tick = (now: number): void => {
    let elapsed = Math.min(MAX_FRAME, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const [lead, trail, crossA, crossB] = this.vertical
      ? this.forward ? [this.bottom, this.top, this.left, this.right] : [this.top, this.bottom, this.left, this.right]
      : this.forward ? [this.right, this.left, this.top, this.bottom] : [this.left, this.right, this.top, this.bottom];
    while (elapsed > 0) {
      const dt = Math.min(STEP, elapsed);
      stepAxis(lead, LEAD, dt);
      stepAxis(trail, TRAIL, dt);
      stepAxis(crossA, CROSS, dt);
      stepAxis(crossB, CROSS, dt);
      elapsed -= dt;
    }
    // A trailing edge must never pass the leading one: the pill would turn inside out.
    if (this.right.pos < this.left.pos) this.left.pos = this.right.pos = (this.left.pos + this.right.pos) / 2;
    if (this.bottom.pos < this.top.pos) this.top.pos = this.bottom.pos = (this.top.pos + this.bottom.pos) / 2;
    if ([this.left, this.right, this.top, this.bottom].every(atRest)) {
      for (const axis of [this.left, this.right, this.top, this.bottom]) {
        axis.pos = axis.target;
        axis.vel = 0;
      }
      this.frame = 0;
      this.paint();
      return;
    }
    this.paint();
    this.frame = requestAnimationFrame(this.tick);
  };

  private paint(): void {
    const width = Math.max(0, this.right.pos - this.left.pos);
    const height = Math.max(0, this.bottom.pos - this.top.pos);
    const style = this.el.style;
    style.transform = `translate3d(${this.left.pos.toFixed(2)}px, ${this.top.pos.toFixed(2)}px, 0)`;
    style.width = `${width.toFixed(2)}px`;
    style.height = `${height.toFixed(2)}px`;
    this.onFrame?.({ left: this.left.pos, top: this.top.pos, width, height });
  }
}

/** Рамка элемента в координатах контейнера, в котором лежит индикатор (с учётом прокрутки). */
export function boxIn(container: HTMLElement, el: Element): IndicatorBox {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    left: r.left - c.left - container.clientLeft + container.scrollLeft,
    top: r.top - c.top - container.clientTop + container.scrollTop,
    width: r.width,
    height: r.height,
  };
}

/** Цвет пункта по тому, насколько под ним индикатор (--liquid-on: 0…1). */
export const liquidMix = (on: string, off: string): string =>
  `color-mix(in srgb, ${on} calc(var(--liquid-on, 0) * 100%), ${off})`;

/** Подложка пункта: до запуска скрипта выбранный закрашен сам, после — её рисует индикатор.
    Своя (тёмная) подложка пункта уходит быстрее, чем наезжает индикатор: иначе белая
    подложка под ней на ходу серела. */
export const LIQUID_ITEM_BG =
  'color-mix(in srgb, var(--liquid-fill) calc(min(1, var(--liquid-on, 0) * 2.5) * 100%), var(--liquid-off-bg, transparent))';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type PillOptions = {
  // Группа (position: relative); индикатор — её абсолютный потомок.
  containerRef: RefObject<HTMLElement | null>;
  indicatorRef: RefObject<HTMLElement | null>;
  // Как найти выбранный пункт внутри группы.
  activeSelector: string;
  // Смена выбора (значение из состояния React).
  activeKey: unknown;
  // Пункты, которым пишется --liquid-on — доля их рамки под индикатором.
  itemSelector?: string;
};

export function useLiquidPill({
  containerRef,
  indicatorRef,
  activeSelector,
  activeKey,
  itemSelector = '[data-liquid-item]',
}: PillOptions): void {
  const engineRef = useRef<LiquidIndicator | null>(null);
  const engineElRef = useRef<HTMLElement | null>(null);
  const activeElRef = useRef<Element | null>(null);
  const itemsRef = useRef<{ el: HTMLElement; box: IndicatorBox }[]>([]);
  const optionsRef = useRef({ activeSelector, itemSelector });
  optionsRef.current = { activeSelector, itemSelector };

  const measure = (el: Element | null): IndicatorBox | null => {
    const container = containerRef.current;
    if (!container || !el || !el.isConnected) return null;
    const box = boxIn(container, el);
    return box.width === 0 && box.height === 0 ? null : box;
  };

  const measureItems = (): void => {
    const container = containerRef.current;
    if (!container) return;
    itemsRef.current = Array.from(container.querySelectorAll<HTMLElement>(optionsRef.current.itemSelector)).map((el) => ({
      el,
      box: boxIn(container, el),
    }));
  };

  // Доля каждого пункта под индикатором: подпись темнеет / светлеет, пока подложка проходит.
  const paintOverlap = (box: IndicatorBox): void => {
    for (const { el, box: b } of itemsRef.current) {
      const ix = Math.max(0, Math.min(box.left + box.width, b.left + b.width) - Math.max(box.left, b.left));
      const iy = Math.max(0, Math.min(box.top + box.height, b.top + b.height) - Math.max(box.top, b.top));
      const area = b.width * b.height;
      const on = area > 0 ? Math.min(1, (ix * iy) / area) : 0;
      el.style.setProperty('--liquid-on', on.toFixed(3));
    }
  };

  const sync = (firstSync: boolean): void => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    let initial = firstSync;
    if (!engineRef.current || engineElRef.current !== indicator) {
      engineRef.current?.destroy();
      engineRef.current = new LiquidIndicator(indicator, paintOverlap);
      engineElRef.current = indicator;
      initial = true;
    }
    const engine = engineRef.current;
    container.dataset.liquid = 'on';
    const nextEl = container.querySelector(optionsRef.current.activeSelector);
    const previousEl = activeElRef.current;
    activeElRef.current = nextEl;
    measureItems();
    const next = measure(nextEl);
    if (!next) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.opacity = '1';
    if (initial || !engine.box || (previousEl === nextEl && !engine.moving)) engine.jump(next);
    else engine.springTo(next);
    // The spring paints on the next frame: until then, the labels follow where the pill is now.
    if (engine.box) paintOverlap(engine.box);
  };

  useIsoLayoutEffect(() => {
    sync(engineRef.current === null);
    // sync reads everything through refs; it re-runs on the explicit key only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    // Раскладка поменялась (ширина экрана, перенос строки, шрифт загрузился): индикатор
    // подстраивается к тому же пункту; группа могла быть скрыта и показаться только сейчас.
    const relayout = (): void => {
      const engine = engineRef.current;
      const indicator = indicatorRef.current;
      if (!engine || !indicator) return;
      measureItems();
      const next = measure(activeElRef.current);
      if (!next) {
        indicator.style.opacity = '0';
        return;
      }
      indicator.style.opacity = '1';
      if (engine.moving) engine.springTo(next);
      else engine.jump(next);
    };
    const resize = new ResizeObserver(relayout);
    resize.observe(container);
    for (const child of Array.from(container.children)) resize.observe(child);
    return () => resize.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    },
    [],
  );
}
