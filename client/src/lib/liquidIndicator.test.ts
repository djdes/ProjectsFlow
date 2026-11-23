import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiquidIndicator, type IndicatorBox } from './liquidIndicator';

// The engine hands precomputed keyframes to the Web Animations API (compositor thread). The
// fake below records them; a test can move its clock (currentTime) or finish it.
type Frame = { offset: number; transform: string };
type FakeAnimation = { frames: Frame[]; duration: number; currentTime: number; cancelled: boolean; onfinish: null | (() => void); cancel: () => void };
let calls: FakeAnimation[] = [];
HTMLElement.prototype.animate = function (keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
  const anim: FakeAnimation = {
    frames: keyframes as unknown as Frame[],
    duration: typeof options === 'number' ? options : Number(options?.duration ?? 0),
    currentTime: 0,
    cancelled: false,
    onfinish: null,
    cancel() {
      this.cancelled = true;
    },
  };
  calls.push(anim);
  return anim as unknown as Animation;
};

const A: IndicatorBox = { left: 0, top: 4, width: 80, height: 32 };
const B: IndicatorBox = { left: 200, top: 4, width: 120, height: 32 };

function setup(onSettle?: () => void): { el: HTMLElement; engine: LiquidIndicator } {
  calls = [];
  document.documentElement.classList.remove('pf-no-motion');
  const el = document.createElement('span');
  return { el, engine: new LiquidIndicator(el, onSettle) };
}

/** Box drawn by a transform string, given the element's CSS size (the scale base). */
function boxOf(transform: string, el: HTMLElement): IndicatorBox {
  const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\)(?: scale\(([-\d.]+), ([-\d.]+)\))?/.exec(transform);
  assert.ok(m, `unexpected transform: ${transform}`);
  const w = Number.parseFloat(el.style.width);
  const h = Number.parseFloat(el.style.height);
  return { left: Number(m[1]), top: Number(m[2]), width: w * Number(m[3] ?? 1), height: h * Number(m[4] ?? 1) };
}
const near = (a: IndicatorBox, b: IndicatorBox, eps = 0.6): boolean =>
  Math.abs(a.left - b.left) < eps && Math.abs(a.top - b.top) < eps && Math.abs(a.width - b.width) < eps && Math.abs(a.height - b.height) < eps;

test('jump places the indicator exactly, without animation', () => {
  const { el, engine } = setup();
  engine.jump(A);
  assert.ok(near(boxOf(el.style.transform, el), A));
  assert.equal(calls.length, 0);
  assert.equal(engine.moving, false);
});

test('springTo animates transform only: from the old box, stretching, to the new box — fast', () => {
  let settled = 0;
  const { el, engine } = setup(() => settled++);
  engine.jump(A);
  engine.springTo(B);
  assert.equal(calls.length, 1);
  const { frames, duration } = calls[0]!;
  assert.ok(frames.every((f) => !('width' in f) && !('height' in f)), 'no layout properties in keyframes');
  assert.ok(near(boxOf(frames[0]!.transform, el), A), 'starts where it stood');
  assert.ok(near(boxOf(frames[frames.length - 1]!.transform, el), B), 'ends on the target');
  assert.ok(duration <= 320, `UI motion stays short, got ${duration} ms`);
  const widest = Math.max(...frames.map((f) => boxOf(f.transform, el).width));
  assert.ok(widest > B.width + 20, `expected a visible stretch, widest ${widest}`);
  // The element already rests on the target under the animation (no fill needed).
  assert.ok(near(boxOf(el.style.transform, el), B));
  assert.equal(engine.moving, true);
  calls[0]!.onfinish?.();
  assert.equal(engine.moving, false);
  assert.equal(settled, 1, 'onSettle fires once, on arrival');
});

test('the edge in the direction of travel leads', () => {
  const { el, engine } = setup();
  engine.jump(B);
  engine.springTo(A);
  const early = boxOf(calls[0]!.frames[4]!.transform, el);
  const leftProgress = (B.left - early.left) / (B.left - A.left);
  const rightProgress = (B.left + B.width - (early.left + early.width)) / (B.left + B.width - (A.left + A.width));
  assert.ok(leftProgress > rightProgress, `left ${leftProgress} should lead right ${rightProgress}`);
});

test('moving down a list, the pill stretches vertically and not sideways', () => {
  const { el, engine } = setup();
  const ROW0: IndicatorBox = { left: 0, top: 0, width: 300, height: 40 };
  const ROW3: IndicatorBox = { left: 0, top: 160, width: 300, height: 40 };
  engine.jump(ROW0);
  engine.springTo(ROW3);
  const boxes = calls[0]!.frames.map((f) => boxOf(f.transform, el));
  assert.ok(Math.max(...boxes.map((b) => b.height)) > 60, 'vertical stretch');
  assert.ok(boxes.every((b) => Math.abs(b.width - 300) < 0.5), 'the cross axis does not stretch');
  const early = boxes[4]!;
  assert.ok(early.top + early.height - 40 > early.top, 'bottom edge leads');
});

test('a new target mid-flight starts from the current position, without a jump', () => {
  const { el, engine } = setup();
  engine.jump(A);
  engine.springTo(B);
  const first = calls[0]!;
  first.currentTime = 50; // 50 ms into the move
  const t = 0.05;
  const samples = first.frames.map((f) => ({ t: f.offset * (first.duration / 1000), box: boxOf(f.transform, el) }));
  const i = samples.findIndex((s) => s.t >= t);
  const a = samples[i - 1]!;
  const b = samples[i]!;
  const k = (t - a.t) / (b.t - a.t);
  const expected: IndicatorBox = {
    left: a.box.left + (b.box.left - a.box.left) * k,
    top: a.box.top + (b.box.top - a.box.top) * k,
    width: a.box.width + (b.box.width - a.box.width) * k,
    height: a.box.height + (b.box.height - a.box.height) * k,
  };
  engine.springTo(A);
  assert.equal(first.cancelled, true, 'the old move is cancelled');
  const second = calls[1]!;
  assert.ok(near(boxOf(second.frames[0]!.transform, el), expected, 1), 'continues from where it was');
  assert.ok(near(boxOf(second.frames[second.frames.length - 1]!.transform, el), A));
});

test('follow tracks the finger with transform only; release carries its velocity', async () => {
  const { el, engine } = setup();
  engine.jump(A);
  for (let x = 16; x <= 64; x += 16) {
    await new Promise((r) => setTimeout(r, 16));
    engine.follow({ ...A, left: x });
    assert.equal(boxOf(el.style.transform, el).left, x, 'no lag under the finger');
  }
  assert.equal(calls.length, 0);
  engine.release({ ...A, left: 64 });
  const furthest = Math.max(...calls[0]!.frames.map((f) => boxOf(f.transform, el).left));
  assert.ok(furthest > 64.5, `momentum carries it past the release point, furthest ${furthest}`);
});

test('with motion turned off, springTo lands at once and still reports arrival', () => {
  let settled = 0;
  const { el, engine } = setup(() => settled++);
  engine.jump(A);
  document.documentElement.classList.add('pf-no-motion');
  engine.springTo(B);
  assert.equal(calls.length, 0);
  assert.ok(near(boxOf(el.style.transform, el), B));
  assert.equal(settled, 1);
  document.documentElement.classList.remove('pf-no-motion');
});

test('destroy cancels the running move', () => {
  const { engine } = setup();
  engine.jump(A);
  engine.springTo(B);
  engine.destroy();
  assert.equal(calls[0]!.cancelled, true);
  assert.equal(engine.moving, false);
});
