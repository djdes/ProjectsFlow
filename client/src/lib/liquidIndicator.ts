// «Жидкий» индикатор выбранной вкладки: подложка, которая перетекает от вкладки к вкладке.
//
// Каждый край — своя пружина. Передний по ходу движения край сидит на жёсткой пружине и
// убегает вперёд, задний — на мягкой и догоняет: подложка вытягивается к цели и стягивается,
// когда приходит. Пружины численные, со скоростью: новая цель посреди пути (быстрые нажатия
// подряд) подхватывается из текущего положения, без рывка. Под пальцем (follow) индикатор
// идёт за ним напрямую, а отпущенный — доезжает пружиной оттуда, где его отпустили, с той
// скоростью, с какой его вели.
//
// Всё пишется прямо в style элемента, без перерисовок React на кадр. Движение — только при
// prefers-reduced-motion: no-preference и без «Анимации: выкл» (html.pf-no-motion); иначе
// индикатор встаёт на место сразу.

export type IndicatorBox = { left: number; top: number; width: number; height: number };

type Axis = { pos: number; vel: number; target: number };
type SpringParams = { stiffness: number; damping: number };

// Затухание 0.78 даёт перелёт ~2% — «чуть-чуть», не пружинка. Задний край — почти без перелёта.
const LEAD: SpringParams = { stiffness: 640, damping: 0.78 };
const TRAIL: SpringParams = { stiffness: 230, damping: 0.94 };
const CROSS: SpringParams = { stiffness: 520, damping: 0.92 };
const STEP = 1 / 240;
const MAX_FRAME = 1 / 20;
const REST_POS = 0.08;
const REST_VEL = 0.5;

export function motionReduced(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.classList.contains('pf-no-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stepAxis(axis: Axis, { stiffness, damping }: SpringParams, dt: number): void {
  const c = 2 * damping * Math.sqrt(stiffness);
  const acceleration = -stiffness * (axis.pos - axis.target) - c * axis.vel;
  axis.vel += acceleration * dt;
  axis.pos += axis.vel * dt;
}

function atRest(axis: Axis): boolean {
  return Math.abs(axis.pos - axis.target) < REST_POS && Math.abs(axis.vel) < REST_VEL;
}

export class LiquidIndicator {
  private readonly left: Axis = { pos: 0, vel: 0, target: 0 };
  private readonly right: Axis = { pos: 0, vel: 0, target: 0 };
  private readonly top: Axis = { pos: 0, vel: 0, target: 0 };
  private readonly bottom: Axis = { pos: 0, vel: 0, target: 0 };
  private placed = false;
  private movingRight = true;
  private frame = 0;
  private last = 0;
  private followAt = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly onSettle?: () => void,
  ) {}

  get box(): IndicatorBox | null {
    if (!this.placed) return null;
    return {
      left: this.left.pos,
      top: this.top.pos,
      width: this.right.pos - this.left.pos,
      height: this.bottom.pos - this.top.pos,
    };
  }

  get moving(): boolean {
    return this.frame !== 0;
  }

  /** Встать на место без движения (первый показ, смена раскладки, reduced motion). */
  jump(box: IndicatorBox): void {
    this.stop();
    for (const [axis, value] of [
      [this.left, box.left],
      [this.right, box.left + box.width],
      [this.top, box.top],
      [this.bottom, box.top + box.height],
    ] as const) {
      axis.pos = value;
      axis.target = value;
      axis.vel = 0;
    }
    this.placed = true;
    this.paint();
  }

  /** Перетечь к новой цели пружинами из текущего положения и скорости. */
  springTo(box: IndicatorBox): void {
    if (!this.placed || motionReduced()) {
      this.jump(box);
      this.onSettle?.();
      return;
    }
    const center = this.left.pos + (this.right.pos - this.left.pos) / 2;
    const nextCenter = box.left + box.width / 2;
    if (Math.abs(nextCenter - center) > 0.5) this.movingRight = nextCenter > center;
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
    for (const [axis, value] of [
      [this.left, box.left],
      [this.right, box.left + box.width],
      [this.top, box.top],
      [this.bottom, box.top + box.height],
    ] as const) {
      axis.vel = dt > 0 && this.placed ? (value - axis.pos) / dt : 0;
      axis.pos = value;
      axis.target = value;
    }
    this.placed = true;
    this.paint();
  }

  /** Палец отпущен — дальше пружины к цели с накопленной скоростью. */
  release(box: IndicatorBox): void {
    this.followAt = 0;
    this.springTo(box);
  }

  destroy(): void {
    this.stop();
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
    const lead = this.movingRight ? this.right : this.left;
    const trail = this.movingRight ? this.left : this.right;
    while (elapsed > 0) {
      const dt = Math.min(STEP, elapsed);
      stepAxis(lead, LEAD, dt);
      stepAxis(trail, TRAIL, dt);
      stepAxis(this.top, CROSS, dt);
      stepAxis(this.bottom, CROSS, dt);
      elapsed -= dt;
    }
    // A trailing edge must never pass the leading one: the pill would turn inside out.
    if (this.right.pos < this.left.pos) {
      const mid = (this.right.pos + this.left.pos) / 2;
      this.left.pos = mid;
      this.right.pos = mid;
    }
    if ([this.left, this.right, this.top, this.bottom].every(atRest)) {
      for (const axis of [this.left, this.right, this.top, this.bottom]) {
        axis.pos = axis.target;
        axis.vel = 0;
      }
      this.paint();
      this.frame = 0;
      this.onSettle?.();
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

/** Короткая смена содержимого: новое входит с размытием и сдвигом по ходу переключения. */
export function swapIn(el: HTMLElement | null, direction: -1 | 0 | 1 = 0): void {
  if (!el || typeof el.animate !== 'function') return;
  if (motionReduced()) {
    el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    return;
  }
  el.animate(
    [
      { opacity: 0, filter: 'blur(6px)', transform: `translate3d(${direction * 16}px, ${direction === 0 ? 6 : 0}px, 0)` },
      { opacity: 1, filter: 'blur(0px)', transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
}
