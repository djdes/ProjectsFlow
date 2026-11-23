// «Жидкий» индикатор выбранной вкладки: подложка, которая перетекает от вкладки к вкладке.
//
// Каждый край — своя пружина. Передний по ходу движения край сидит на жёсткой пружине и
// убегает вперёд, задний — на мягкой и догоняет: подложка вытягивается к цели и стягивается,
// когда приходит. Новая цель посреди пути (быстрые нажатия подряд) подхватывается из текущего
// положения и скорости, без рывка. Под пальцем (follow) индикатор идёт за ним напрямую, а
// отпущенный — доезжает пружиной оттуда, где его отпустили, с той скоростью, с какой его вели.
//
// Производительность. Ход пружин просчитывается заранее и отдаётся браузеру ключевыми кадрами
// Web Animations только по transform (сдвиг + масштаб), без width/height на кадр: анимация
// идёт в потоке композитора и не дёргается, пока главный поток занят (React дорисовывает
// новую вкладку как раз в момент переключения). Размер элемента меняется один раз — на старте
// хода, — а промежуточная ширина рисуется масштабом. Время хода — до ~250 мс (интерфейсное
// движение не длиннее 300 мс).
//
// Движение — только при prefers-reduced-motion: no-preference и без «Анимации: выкл»
// (html.pf-no-motion); иначе индикатор встаёт на место сразу.

export type IndicatorBox = { left: number; top: number; width: number; height: number };

type Edges = [number, number, number, number]; // left, right, top, bottom
type SpringParams = { stiffness: number; damping: number };
type Sample = { t: number; edges: Edges };

// Передний край — почти без перелёта (<1%), задний — без перелёта; ход вкладки занимает
// ~270 мс, длинный перелёт — ~300 мс, растяжение по пути — треть ширины и больше.
const LEAD: SpringParams = { stiffness: 2000, damping: 0.9 };
const TRAIL: SpringParams = { stiffness: 650, damping: 1 };
const CROSS: SpringParams = { stiffness: 1200, damping: 1 };
const STEP = 1 / 480;
const SAMPLE = 1 / 120; // ключевой кадр на каждый кадр экрана 120 Гц
const MAX_T = 0.6;
// Последний пиксель не доползает, а встаёт на место: хвост пружины глазу не виден.
const REST_POS = 1;
const REST_VEL = 40;

export function motionReduced(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.classList.contains('pf-no-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const edgesOf = (box: IndicatorBox): Edges => [box.left, box.left + box.width, box.top, box.top + box.height];
const px = (n: number): string => `${n.toFixed(2)}px`;

export class LiquidIndicator {
  private placed = false;
  // Где индикатор стоит (или куда идёт, если идёт анимация) и с какой скоростью его отпустили.
  private edges: Edges = [0, 0, 0, 0];
  private vel: Edges = [0, 0, 0, 0];
  private size = { w: 0, h: 0 };
  private anim: Animation | null = null;
  private samples: Sample[] = [];
  private followAt = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly onSettle?: () => void,
  ) {
    el.style.transformOrigin = '0 0';
  }

  get box(): IndicatorBox | null {
    if (!this.placed) return null;
    const [l, r, t, b] = this.current().edges;
    return { left: l, top: t, width: r - l, height: b - t };
  }

  get moving(): boolean {
    return this.anim !== null;
  }

  /** Встать на место без движения (первый показ, смена раскладки, reduced motion). */
  jump(box: IndicatorBox): void {
    this.cancel();
    this.placed = true;
    this.edges = edgesOf(box);
    this.vel = [0, 0, 0, 0];
    this.setSize(box.width, box.height);
    this.el.style.transform = `translate3d(${px(box.left)}, ${px(box.top)}, 0)`;
  }

  /** Перетечь к новой цели пружинами из текущего положения и скорости. */
  springTo(box: IndicatorBox): void {
    if (!this.placed || motionReduced() || typeof this.el.animate !== 'function') {
      this.jump(box);
      this.onSettle?.();
      return;
    }
    const { edges: from, vel } = this.current();
    this.cancel();
    const target = edgesOf(box);
    const still = vel.every((v) => Math.abs(v) < REST_VEL);
    if (still && from.every((v, i) => Math.abs(v - target[i]!) < REST_POS)) {
      this.jump(box);
      this.onSettle?.();
      return;
    }
    const samples = simulate(from, vel, target);
    const duration = samples[samples.length - 1]!.t;
    // Размер — целевой; от него считается масштаб промежуточных кадров, в покое масштаб 1.
    this.setSize(box.width, box.height);
    const w = box.width || 1;
    const h = box.height || 1;
    const frames = samples.map(({ t, edges: [l, r, top, b] }) => ({
      offset: t / duration,
      transform: `translate3d(${px(l)}, ${px(top)}, 0) scale(${((r - l) / w).toFixed(4)}, ${((b - top) / h).toFixed(4)})`,
    }));
    this.edges = target;
    this.vel = [0, 0, 0, 0];
    this.samples = samples;
    // Под анимацией — конечное положение: по окончании (без fill) элемент уже стоит в нём.
    this.el.style.transform = `translate3d(${px(box.left)}, ${px(box.top)}, 0)`;
    const anim = this.el.animate(frames, { duration: duration * 1000, easing: 'linear' });
    this.anim = anim;
    anim.onfinish = () => {
      if (this.anim !== anim) return;
      this.anim = null;
      this.samples = [];
      this.onSettle?.();
    };
  }

  /** Прямое ведение пальцем: только transform, скорость запоминается для отпускания. */
  follow(box: IndicatorBox): void {
    const now = performance.now();
    const prev = this.current().edges;
    const dt = this.followAt ? Math.max(1, now - this.followAt) / 1000 : 0;
    this.followAt = now;
    this.cancel();
    const next = edgesOf(box);
    this.vel = dt > 0 && this.placed ? (next.map((x, i) => (x - prev[i]!) / dt) as Edges) : [0, 0, 0, 0];
    this.edges = next;
    this.placed = true;
    if (!this.size.w || !this.size.h) this.setSize(box.width, box.height);
    this.el.style.transform = `translate3d(${px(box.left)}, ${px(box.top)}, 0) scale(${(box.width / (this.size.w || 1)).toFixed(4)}, ${(box.height / (this.size.h || 1)).toFixed(4)})`;
  }

  /** Палец отпущен — дальше пружины к цели с накопленной скоростью. */
  release(box: IndicatorBox): void {
    this.followAt = 0;
    this.springTo(box);
  }

  destroy(): void {
    this.cancel();
  }

  private cancel(): void {
    const anim = this.anim;
    this.anim = null;
    this.samples = [];
    anim?.cancel();
  }

  private setSize(w: number, h: number): void {
    if (this.size.w !== w) this.el.style.width = px(w);
    if (this.size.h !== h) this.el.style.height = px(h);
    this.size = { w, h };
  }

  /** Edges and velocity right now: sampled from the running animation, if any. */
  private current(): { edges: Edges; vel: Edges } {
    const s = this.samples;
    if (!this.anim || s.length < 2) return { edges: this.edges, vel: this.vel };
    const ct = this.anim.currentTime;
    const t = typeof ct === 'number' ? ct / 1000 : 0;
    let i = s.findIndex((x) => x.t >= t);
    if (i <= 0) i = i === 0 ? 1 : s.length - 1;
    const a = s[i - 1]!;
    const b = s[i]!;
    const span = b.t - a.t || 1;
    const k = Math.min(1, Math.max(0, (t - a.t) / span));
    return {
      edges: a.edges.map((v, j) => v + (b.edges[j]! - v) * k) as Edges,
      vel: a.edges.map((v, j) => (b.edges[j]! - v) / span) as Edges,
    };
  }
}

/** Steps the four edge springs from `from` (with velocity) to `target`; samples every SAMPLE s. */
function simulate(from: Edges, vel: Edges, target: Edges): Sample[] {
  const dx = (target[0] + target[1] - from[0] - from[1]) / 2;
  const dy = (target[2] + target[3] - from[2] - from[3]) / 2;
  const vertical = Math.abs(dy) > Math.abs(dx);
  const right = dx > 0;
  const down = dy > 0;
  const params: SpringParams[] = vertical
    ? [CROSS, CROSS, down ? TRAIL : LEAD, down ? LEAD : TRAIL]
    : [right ? TRAIL : LEAD, right ? LEAD : TRAIL, CROSS, CROSS];
  const pos = [...from] as Edges;
  const v = [...vel] as Edges;
  const samples: Sample[] = [{ t: 0, edges: [...pos] as Edges }];
  let t = 0;
  let next = SAMPLE;
  while (t < MAX_T) {
    for (let i = 0; i < 4; i++) {
      const { stiffness, damping } = params[i]!;
      const c = 2 * damping * Math.sqrt(stiffness);
      v[i]! += (-stiffness * (pos[i]! - target[i]!) - c * v[i]!) * STEP;
      pos[i]! += v[i]! * STEP;
    }
    // A trailing edge must never pass the leading one: the pill would turn inside out.
    for (const [a, b] of [[0, 1], [2, 3]] as const) {
      if (pos[b] < pos[a]) {
        const mid = (pos[a] + pos[b]) / 2;
        pos[a] = mid;
        pos[b] = mid;
      }
    }
    t += STEP;
    if (t >= next - 1e-9) {
      next += SAMPLE;
      const rest = pos.every((p, i) => Math.abs(p - target[i]!) < REST_POS && Math.abs(v[i]!) < REST_VEL);
      samples.push({ t, edges: rest ? ([...target] as Edges) : ([...pos] as Edges) });
      if (rest) return samples;
    }
  }
  samples.push({ t: t + SAMPLE, edges: [...target] as Edges });
  return samples;
}

/**
 * Рамка элемента в координатах контейнера, в котором лежит индикатор (с учётом прокрутки).
 * Масштаб предков (окно ещё раскрывается, кнопка нажата) вычитается: рамка — в раскладочных
 * пикселях контейнера, а не экранных.
 */
export function boxIn(container: HTMLElement, el: Element): IndicatorBox {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const sx = container.offsetWidth > 0 ? c.width / container.offsetWidth : 1;
  const sy = container.offsetHeight > 0 ? c.height / container.offsetHeight : 1;
  return {
    left: (r.left - c.left) / sx - container.clientLeft + container.scrollLeft,
    top: (r.top - c.top) / sy - container.clientTop + container.scrollTop,
    width: r.width / sx,
    height: r.height / sy,
  };
}

/**
 * Короткая смена содержимого: новое проявляется и чуть сдвигается по ходу переключения.
 * Только opacity и transform (поток композитора), без размытия: блок большой, размытие на
 * нём дорого на телефоне.
 */
export function swapIn(el: HTMLElement | null, direction: -1 | 0 | 1 = 0): void {
  if (!el || typeof el.animate !== 'function') return;
  if (motionReduced()) {
    el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    return;
  }
  el.animate(
    [
      { opacity: 0.2, transform: `translate3d(${direction * 10}px, ${direction === 0 ? 4 : 0}px, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  );
}
