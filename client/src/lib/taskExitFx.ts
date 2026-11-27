// Exit animations of a task card: «принять / выполнено» and «удалить».
//
// The card on screen is cloned into a fixed layer (the «ghost») and the clone plays the exit,
// while the real list item closes its height so the neighbours slide up into the gap. Only
// after that does the caller send the mutation: when the list re-renders without the task,
// the item is already zero-height and nothing jumps. React never learns about any of this:
// the collapse is a Web Animation on the real node (fill: forwards), the ghost lives on <body>.
//
//   complete → a green check stamps where it was pressed, the card washes green from that
//              point and slides away to the right, the gap closes. With leave: false (the card
//              stays visible, e.g. moves to a visible «Готово» column) — only the stamp and a
//              green pulse on the card itself.
//   delete   → the card trembles, breaks into glass-like shards that fly apart and fall, a
//              thin red shock ring, the gap closes.
//
// Reduced motion (system setting or «Анимации: выкл» in the profile) → a quick fade, no
// movement. Everything here is DOM-only (no React), so lib/ is its home.

export type TaskExitKind = 'complete' | 'delete';

export type TaskExitOptions = {
  // Where the gesture happened: the pressed button (its centre is used) or a client point.
  // The check stamp and the green wash start there. Default — the card's trailing edge.
  origin?: Element | { x: number; y: number } | null;
  // complete only: does the card leave the list (true, default) or stay (false → pulse).
  leave?: boolean;
  // Wait before starting — lets a closing confirm dialog fade out first.
  delay?: number;
  // Several tasks: delay between them, in ms.
  stagger?: number;
};

export type TaskExitHandle = {
  // The mutation failed — bring the cards back.
  restore: () => void;
};

// A confirm dialog fades out in about this long — start the exit after it, not under it.
export const DIALOG_CLOSE_MS = 170;

const NOOP_HANDLE: TaskExitHandle = { restore: () => {} };

// Curves: arrival with a soft landing, a collapse that starts and ends gently, a throw that
// accelerates out (stageshow: «a swipe is a flick», «landings are soft»).
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const EASE_COLLAPSE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const EASE_THROW = 'cubic-bezier(0.55, 0, 0.85, 0.35)';
const EASE_SHARD = 'cubic-bezier(0.15, 0.65, 0.35, 1)';

// Bulk delete: shards only for the first cards, the rest just fade and collapse.
const MAX_SHATTERED = 10;
// After the caller resolves, the collapsed item waits for React to remove it. If the task
// never leaves (an unexpected re-render kept it), the card comes back on its own.
const HEAL_AFTER_MS = 6000;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));

function reducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.classList.contains('pf-no-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canAnimate(): boolean {
  return typeof document !== 'undefined' && typeof Element !== 'undefined' && 'animate' in Element.prototype;
}

function visibleCards(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(taskSelector(id))).filter((el) => {
    if (el.closest('[data-pf-exit-ghost]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  });
}

// The element that closes its height: the card itself, or its single-child wrappers (dnd,
// swipe, collapse grids) up to the list. Never the list: stop at a parent with siblings or at
// a stack with a gap.
function collapseTargetOf(card: HTMLElement): HTMLElement {
  let node = card;
  for (let i = 0; i < 10; i += 1) {
    const parent = node.parentElement;
    if (!parent || parent === document.body || parent.hasAttribute('data-pf-main')) break;
    if (parent.childElementCount !== 1) {
      // SwipeToAct / KanbanCard may render an absolute aria-hidden overlay alongside the flow child.
      const flowChildren = Array.from(parent.children).filter(
        (c) => c === node || getComputedStyle(c).position !== 'absolute',
      );
      if (flowChildren.length !== 1) break;
    }
    const cs = getComputedStyle(parent);
    if ((parseFloat(cs.rowGap) || 0) > 0) break;
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break;
    node = parent;
  }
  return node;
}

// The gap of the stack the item sits in: the collapsed item also takes back one gap, so the
// stack is exactly as tall as it will be without the item.
function stackGapOf(item: HTMLElement): { gap: number; side: 'start' | 'end' } | null {
  const parent = item.parentElement;
  if (!parent) return null;
  const cs = getComputedStyle(parent);
  const column =
    (cs.display.includes('flex') && cs.flexDirection.startsWith('column')) || cs.display.includes('grid');
  const gap = parseFloat(cs.rowGap) || 0;
  if (!column || gap <= 0) return null;
  const siblings = Array.from(parent.children).filter(
    (c) => c !== item && (c as HTMLElement).offsetHeight > 0,
  );
  if (siblings.length === 0) return null;
  // The first item gives back the gap after it; any other — the gap before it.
  return { gap, side: parent.firstElementChild === item ? 'end' : 'start' };
}

function clipRectOf(card: HTMLElement): DOMRect {
  const main = card.closest<HTMLElement>('[data-pf-main]');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!main) return new DOMRect(0, 0, vw, vh);
  const r = main.getBoundingClientRect();
  const left = Math.max(0, r.left);
  const top = Math.max(0, r.top);
  return new DOMRect(left, top, Math.min(vw, r.right) - left, Math.min(vh, r.bottom) - top);
}

function originPoint(origin: TaskExitOptions['origin'], rect: DOMRect): { x: number; y: number } {
  if (origin && 'getBoundingClientRect' in origin) {
    const r = origin.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
  } else if (origin && 'x' in origin) {
    return { x: origin.x - rect.left, y: origin.y - rect.top };
  }
  return { x: rect.width - Math.min(28, rect.width / 4), y: rect.height / 2 };
}

function makeStage(clip: DOMRect): HTMLElement {
  const stage = document.createElement('div');
  stage.setAttribute('data-pf-exit-ghost', '');
  stage.setAttribute('aria-hidden', 'true');
  Object.assign(stage.style, {
    position: 'fixed',
    left: `${clip.left}px`,
    top: `${clip.top}px`,
    width: `${clip.width}px`,
    height: `${clip.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '40',
    contain: 'strict',
  });
  document.body.appendChild(stage);
  return stage;
}

// A visual copy of the card: same box, same paint, no ids/roles/handlers.
function makeGhost(card: HTMLElement, rect: DOMRect): HTMLElement {
  const ghost = card.cloneNode(true) as HTMLElement;
  for (const el of [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>('*'))]) {
    el.removeAttribute('id');
    el.removeAttribute('data-pf-task-id');
    el.removeAttribute('tabindex');
  }
  ghost.removeAttribute('role');
  ghost.removeAttribute('aria-current');
  ghost.removeAttribute('aria-pressed');
  const cs = getComputedStyle(card);
  const ring = cs.getPropertyValue('--pf-card-ring');
  if (ring) ghost.style.setProperty('--pf-card-ring', ring);
  Object.assign(ghost.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    boxSizing: 'border-box',
    transform: 'none',
    transition: 'none',
    animation: 'none',
    opacity: '1',
    visibility: 'visible',
    overflow: 'hidden',
    isolation: 'isolate',
    color: cs.color,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    backgroundColor: cs.backgroundColor,
    boxShadow: cs.boxShadow,
    borderRadius: cs.borderRadius,
  });
  return ghost;
}

// A green circle with a check that draws itself — the stamp of «done».
function makeStamp(size: number): HTMLElement {
  const stamp = document.createElement('div');
  Object.assign(stamp.style, {
    position: 'absolute',
    width: `${size}px`,
    height: `${size}px`,
    marginLeft: `${-size / 2}px`,
    marginTop: `${-size / 2}px`,
    borderRadius: '9999px',
    background: 'oklch(var(--done))',
    color: 'oklch(var(--card))',
    display: 'grid',
    placeItems: 'center',
    boxShadow: '0 4px 14px oklch(var(--done) / 0.35)',
    zIndex: '2',
  });
  const glyph = Math.round(size * 0.56);
  stamp.innerHTML =
    `<svg width="${glyph}" height="${glyph}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="3" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M20 6 9 17l-5-5" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>`;
  return stamp;
}

type Plan = {
  id: string;
  card: HTMLElement;
  rect: DOMRect;
  item: HTMLElement;
};

// An element we hid or collapsed, and how to give it back.
type Held = {
  id: string;
  el: HTMLElement;
  animations: Animation[];
  prevOverflow: string | null;
};

function taskSelector(id: string): string {
  return `[data-pf-task-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`;
}

// Closes the item's height (and one stack gap) — the neighbours slide up.
function collapse(id: string, item: HTMLElement, delay: number, duration: number): Held {
  const cs = getComputedStyle(item);
  const height = item.getBoundingClientRect().height;
  const gap = stackGapOf(item);
  const mbs = parseFloat(cs.marginBlockStart) || 0;
  const mbe = parseFloat(cs.marginBlockEnd) || 0;
  const prevOverflow = item.style.overflow;
  item.style.overflow = 'hidden';
  const from: Keyframe = {
    height: `${height}px`,
    minHeight: '0px',
    paddingBlockStart: cs.paddingBlockStart,
    paddingBlockEnd: cs.paddingBlockEnd,
    borderBlockStartWidth: cs.borderBlockStartWidth,
    borderBlockEndWidth: cs.borderBlockEndWidth,
    marginBlockStart: `${mbs}px`,
    marginBlockEnd: `${mbe}px`,
    opacity: 0,
  };
  const to: Keyframe = {
    height: '0px',
    minHeight: '0px',
    paddingBlockStart: '0px',
    paddingBlockEnd: '0px',
    borderBlockStartWidth: '0px',
    borderBlockEndWidth: '0px',
    marginBlockStart: `${gap?.side === 'start' ? mbs - gap.gap : mbs}px`,
    marginBlockEnd: `${gap?.side === 'end' ? mbe - gap.gap : mbe}px`,
    opacity: 0,
  };
  const animation = item.animate([from, to], {
    duration,
    delay,
    easing: EASE_COLLAPSE,
    fill: 'both',
  });
  return { id, el: item, animations: [animation], prevOverflow };
}

function fadeOut(id: string, el: HTMLElement, delay: number): Held {
  const animation = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay, easing: 'ease-out', fill: 'both' });
  return { id, el, animations: [animation], prevOverflow: null };
}

function release(h: Held): void {
  for (const a of h.animations) a.cancel();
  h.animations = [];
  if (h.prevOverflow !== null) h.el.style.overflow = h.prevOverflow;
}

function reveal(h: Held): void {
  release(h);
  if (h.el.isConnected) h.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}

// ---------------------------------------------------------------- complete ----

function playComplete(plan: Plan, stage: HTMLElement, clip: DOMRect, origin: TaskExitOptions['origin']): number {
  const { card, rect } = plan;
  const ghost = makeGhost(card, rect);
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'absolute',
    left: `${rect.left - clip.left}px`,
    top: `${rect.top - clip.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  wrap.appendChild(ghost);
  stage.appendChild(wrap);

  const o = originPoint(origin, rect);
  const reach = Math.hypot(Math.max(o.x, rect.width - o.x), Math.max(o.y, rect.height - o.y)) + 4;

  // Green wash under the text, growing from the pressed point.
  const wash = document.createElement('div');
  Object.assign(wash.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '-1',
    borderRadius: 'inherit',
    background: 'var(--done-soft)',
  });
  ghost.prepend(wash);
  wash.animate(
    [{ clipPath: `circle(0px at ${o.x}px ${o.y}px)` }, { clipPath: `circle(${reach}px at ${o.x}px ${o.y}px)` }],
    { duration: 300, easing: EASE_OUT, fill: 'both' },
  );
  ghost.animate(
    [
      { boxShadow: getComputedStyle(card).boxShadow },
      { boxShadow: '0 0 0 1.5px oklch(var(--done) / 0.55), 0 8px 22px oklch(var(--done) / 0.16)' },
    ],
    { duration: 260, easing: EASE_OUT, fill: 'both' },
  );

  const stampSize = window.matchMedia?.('(pointer: coarse)').matches ? 34 : 26;
  const stamp = makeStamp(stampSize);
  Object.assign(stamp.style, { left: `${o.x}px`, top: `${o.y}px` });
  wrap.appendChild(stamp);
  stamp.animate(
    [
      { transform: 'scale(0.3)', opacity: 0 },
      { transform: 'scale(1.14)', opacity: 1, offset: 0.6 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 300, easing: EASE_POP, fill: 'both' },
  );
  stamp.querySelector('path')?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: 240,
    delay: 90,
    easing: EASE_OUT,
    fill: 'both',
  });

  // The card is filed away to the right — the same direction as the «done» swipe.
  const throwX = Math.max(48, Math.min(rect.width * 0.45, 160));
  const leaveDelay = 280;
  const leaveDuration = 300;
  wrap.animate(
    [
      { transform: 'translateX(0) scale(1)', opacity: 1 },
      { transform: `translateX(${throwX}px) scale(0.97)`, opacity: 0 },
    ],
    { duration: leaveDuration, delay: leaveDelay, easing: EASE_THROW, fill: 'both' },
  );
  return leaveDelay + leaveDuration;
}

// The card stays (moves to a visible column): stamp + green pulse on the card itself.
function playCompletePulse(plan: Plan, stage: HTMLElement, clip: DOMRect, origin: TaskExitOptions['origin']): number {
  const { card, rect } = plan;
  const o = originPoint(origin, rect);
  const stampSize = window.matchMedia?.('(pointer: coarse)').matches ? 34 : 26;
  const stamp = makeStamp(stampSize);
  Object.assign(stamp.style, { left: `${rect.left - clip.left + o.x}px`, top: `${rect.top - clip.top + o.y}px` });
  stage.appendChild(stamp);
  stamp.animate(
    [
      { transform: 'scale(0.3)', opacity: 0 },
      { transform: 'scale(1.14)', opacity: 1, offset: 0.35 },
      { transform: 'scale(1)', opacity: 1, offset: 0.7 },
      { transform: 'scale(0.9)', opacity: 0 },
    ],
    { duration: 560, easing: EASE_OUT, fill: 'both' },
  );
  stamp.querySelector('path')?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: 220,
    delay: 70,
    easing: EASE_OUT,
    fill: 'both',
  });
  card.animate(
    [
      { boxShadow: '0 0 0 0 oklch(var(--done) / 0)' },
      { boxShadow: '0 0 0 2px oklch(var(--done) / 0.6), 0 0 18px oklch(var(--done) / 0.25)', offset: 0.3 },
      { boxShadow: '0 0 0 0 oklch(var(--done) / 0)' },
    ],
    { duration: 640, easing: 'ease-out', composite: 'add' },
  );
  return 380;
}

// ------------------------------------------------------------------ delete ----

type Point = { x: number; y: number };

// A grid of points with the inner ones jittered — triangles over it tile the card exactly,
// like cracked glass.
function shardPolygons(w: number, h: number): Point[][] {
  const cols = Math.max(3, Math.min(6, Math.round(w / 70)));
  const rows = Math.max(2, Math.min(3, Math.round(h / 46)));
  const cw = w / cols;
  const ch = h / rows;
  const pts: Point[][] = [];
  for (let r = 0; r <= rows; r += 1) {
    const row: Point[] = [];
    for (let c = 0; c <= cols; c += 1) {
      const edgeX = c === 0 || c === cols;
      const edgeY = r === 0 || r === rows;
      const jx = edgeX ? 0 : (Math.random() - 0.5) * cw * 0.6;
      const jy = edgeY ? 0 : (Math.random() - 0.5) * ch * 0.6;
      row.push({ x: c * cw + jx, y: r * ch + jy });
    }
    pts.push(row);
  }
  const polys: Point[][] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = pts[r]![c]!;
      const b = pts[r]![c + 1]!;
      const d = pts[r + 1]![c]!;
      const e = pts[r + 1]![c + 1]!;
      if ((r + c) % 2 === 0) {
        polys.push([a, b, e], [a, e, d]);
      } else {
        polys.push([a, b, d], [b, e, d]);
      }
    }
  }
  return polys;
}

function playDelete(plan: Plan, stage: HTMLElement, clip: DOMRect, shatter: boolean): number {
  const { card, rect } = plan;
  const burst = document.createElement('div');
  Object.assign(burst.style, {
    position: 'absolute',
    left: `${rect.left - clip.left}px`,
    top: `${rect.top - clip.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  stage.appendChild(burst);

  const tint = (ghost: HTMLElement): void => {
    const layer = document.createElement('div');
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '-1',
      borderRadius: 'inherit',
      background: 'var(--destructive-soft)',
    });
    ghost.prepend(layer);
    layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out', fill: 'both' });
  };

  // Anticipation: a short tremble and a squeeze before the break.
  const breakAt = 130;
  burst.animate(
    [
      { transform: 'translateX(0) scale(1)' },
      { transform: 'translateX(-2px) scale(0.99)', offset: 0.25 },
      { transform: 'translateX(2px) scale(0.98)', offset: 0.5 },
      { transform: 'translateX(-1px) scale(0.975)', offset: 0.75 },
      { transform: 'translateX(0) scale(0.97)' },
    ],
    { duration: breakAt, easing: 'linear', fill: 'forwards' },
  );

  if (!shatter) {
    const ghost = makeGhost(card, rect);
    tint(ghost);
    burst.appendChild(ghost);
    ghost.animate(
      [
        { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' },
        { transform: 'scale(0.9)', opacity: 0, filter: 'blur(3px)' },
      ],
      { duration: 260, delay: breakAt, easing: EASE_OUT, fill: 'both' },
    );
    return breakAt + 260;
  }

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;
  const spread = Math.min(1, Math.max(0.55, w / 360));
  let longest = 0;
  for (const poly of shardPolygons(w, h)) {
    const shard = makeGhost(card, rect);
    tint(shard);
    shard.style.clipPath = `polygon(${poly.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})`;
    const mx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const my = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    shard.style.transformOrigin = `${mx}px ${my}px`;
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.hypot(dx, dy * 1.6) || 1;
    // A short burst outwards, then the pieces fall: they read as a card that broke, not as
    // confetti over the whole screen.
    const force = (26 + Math.random() * 40) * spread;
    const vx = (dx / len) * force + (Math.random() - 0.5) * 14;
    const vy = ((dy * 1.6) / len) * force * 0.6 - 10 - Math.random() * 10;
    const rot = (Math.random() - 0.5) * 56;
    const duration = 560 + Math.random() * 160;
    longest = Math.max(longest, duration);
    shard.animate(
      [
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
        {
          transform: `translate(${(vx * 0.7).toFixed(1)}px, ${(vy * 0.7).toFixed(1)}px) rotate(${(rot * 0.5).toFixed(1)}deg) scale(0.95)`,
          opacity: 1,
          offset: 0.3,
        },
        {
          transform: `translate(${(vx * 0.9).toFixed(1)}px, ${(vy * 0.4 + 26).toFixed(1)}px) rotate(${(rot * 0.8).toFixed(1)}deg) scale(0.86)`,
          opacity: 0.85,
          offset: 0.6,
        },
        {
          transform: `translate(${vx.toFixed(1)}px, ${(vy * 0.2 + 72).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(0.7)`,
          opacity: 0,
        },
      ],
      { duration, delay: breakAt, easing: EASE_SHARD, fill: 'both' },
    );
    burst.appendChild(shard);
  }

  // A thin red shock ring from the centre at the moment of the break.
  const ring = document.createElement('div');
  const ringSize = Math.min(w * 0.8, 180);
  Object.assign(ring.style, {
    position: 'absolute',
    left: `${cx - ringSize / 2}px`,
    top: `${cy - ringSize / 2}px`,
    width: `${ringSize}px`,
    height: `${ringSize}px`,
    borderRadius: '9999px',
    border: '2px solid oklch(var(--destructive) / 0.55)',
  });
  burst.appendChild(ring);
  ring.animate(
    [
      { transform: 'scale(0.15)', opacity: 0.9 },
      { transform: 'scale(1.25)', opacity: 0 },
    ],
    { duration: 420, delay: breakAt, easing: EASE_OUT, fill: 'both' },
  );

  // A few sparks.
  for (let i = 0; i < 8; i += 1) {
    const spark = document.createElement('div');
    const size = 3 + Math.random() * 3;
    const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.6;
    const dist = (30 + Math.random() * 40) * spread;
    Object.assign(spark.style, {
      position: 'absolute',
      left: `${cx + (Math.random() - 0.5) * w * 0.5}px`,
      top: `${cy + (Math.random() - 0.5) * h * 0.4}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '9999px',
      background: i % 2 ? 'oklch(var(--destructive))' : 'oklch(var(--muted-foreground) / 0.7)',
    });
    burst.appendChild(spark);
    spark.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        {
          transform: `translate(${(Math.cos(angle) * dist).toFixed(1)}px, ${(Math.sin(angle) * dist * 0.7 + 20).toFixed(1)}px) scale(0.3)`,
          opacity: 0,
        },
      ],
      { duration: 380 + Math.random() * 160, delay: breakAt, easing: EASE_OUT, fill: 'both' },
    );
  }
  return breakAt + longest;
}

// ------------------------------------------------------------------- public ----

// Plays the exit for each visible card of the given tasks and resolves when the list has
// closed the gap — then the caller sends the mutation. Not on screen → resolves at once.
export async function playTaskExit(
  ids: string | readonly string[],
  kind: TaskExitKind,
  options: TaskExitOptions = {},
): Promise<TaskExitHandle> {
  if (!canAnimate()) return NOOP_HANDLE;
  const list = typeof ids === 'string' ? [ids] : ids;
  const { leave = true, delay = 0, stagger = 45, origin = null } = options;
  if (delay > 0) await wait(delay);

  const plans: Plan[] = [];
  for (const id of list) {
    for (const card of visibleCards(id)) {
      plans.push({ id, card, rect: card.getBoundingClientRect(), item: collapseTargetOf(card) });
    }
  }
  if (plans.length === 0) return NOOP_HANDLE;

  const reduced = reducedMotion();
  const held: Held[] = [];
  const stages: HTMLElement[] = [];
  let total = 0;

  plans.forEach((plan, index) => {
    const offset = index * stagger;
    const pulseOnly = kind === 'complete' && !leave;
    // Table rows can't be cloned into a box or closed by height — they only fade.
    if (plan.card.tagName === 'TR') {
      if (pulseOnly) return;
      held.push(fadeOut(plan.id, plan.card, offset));
      total = Math.max(total, offset + 170);
      return;
    }
    if (reduced) {
      if (pulseOnly) return;
      const h = collapse(plan.id, plan.item, offset + 160, 1);
      h.animations.push(...fadeOut(plan.id, plan.item, offset).animations);
      held.push(h);
      total = Math.max(total, offset + 170);
      return;
    }
    const clip = clipRectOf(plan.card);
    const stage = makeStage(clip);
    stages.push(stage);
    if (pulseOnly) {
      total = Math.max(total, offset + playCompletePulse(plan, stage, clip, index === 0 ? origin : null));
      return;
    }
    // The ghost covers the real card from the first frame; the real one only closes its room.
    let collapseAt: number;
    if (kind === 'complete') {
      const end = playComplete(plan, stage, clip, index === 0 ? origin : null);
      collapseAt = end - 180;
    } else {
      playDelete(plan, stage, clip, index < MAX_SHATTERED);
      collapseAt = 200;
    }
    const collapseFor = 300;
    held.push(collapse(plan.id, plan.item, offset + collapseAt, collapseFor));
    total = Math.max(total, offset + collapseAt + collapseFor);
    // Stagger: later cards hold their first frame (fill: both) until their turn.
    if (offset > 0) {
      for (const a of stage.getAnimations({ subtree: true })) {
        const timing = a.effect?.getTiming();
        if (a.effect && timing) a.effect.updateTiming({ delay: (Number(timing.delay) || 0) + offset });
      }
    }
  });

  // Particles may outlive the collapse; the layer goes when its last animation ends.
  for (const stage of stages) {
    const animations = stage.getAnimations({ subtree: true });
    void Promise.allSettled(animations.map((a) => a.finished)).then(() => stage.remove());
  }

  await wait(total);

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    for (const stage of stages) stage.remove();
    for (const h of held) reveal(h);
  };

  // The collapsed item waits for React to drop the task. React may re-create the card inside
  // the item first (a wrapper switched) — the item still holds the task, so it stays closed.
  // An item left without the task (its wrapper outlived the card) is released. A task that
  // is still there long after (it never left the list) comes back.
  const started = Date.now();
  const heal = (): void => {
    if (restored) return;
    let waiting = false;
    for (const h of held) {
      if (h.animations.length === 0 || !h.el.isConnected) continue;
      const selector = taskSelector(h.id);
      if (h.el.matches(selector) || h.el.querySelector(selector)) {
        waiting = true;
        continue;
      }
      release(h);
    }
    if (!waiting) return;
    if (Date.now() - started > HEAL_AFTER_MS) {
      restore();
      return;
    }
    window.setTimeout(heal, 300);
  };
  window.setTimeout(heal, 300);

  return { restore };
}

// Is the board column of this status on screen? A card done on a board where «Готово» is
// visible moves there itself (pulse only); otherwise it leaves.
export function isBoardColumnOnScreen(status: string): boolean {
  if (typeof document === 'undefined') return false;
  const column = document.querySelector(`[data-pf-column-status="${status}"]`);
  if (!column) return false;
  const r = column.getBoundingClientRect();
  return r.width > 40 && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
}

// Convenience for «animate, then mutate; on failure bring it back».
export async function withTaskExit<T>(
  ids: string | readonly string[],
  kind: TaskExitKind,
  mutate: () => Promise<T>,
  options?: TaskExitOptions,
): Promise<T> {
  const fx = await playTaskExit(ids, kind, options);
  try {
    return await mutate();
  } catch (error) {
    fx.restore();
    throw error;
  }
}
