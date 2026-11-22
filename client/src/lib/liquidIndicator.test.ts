import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiquidIndicator, type IndicatorBox } from './liquidIndicator';

// A hand-driven clock: rAF callbacks run only when the test advances time, so the springs can
// be stepped frame by frame and every intermediate shape inspected.
let clock = 0;
let queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextId = 1;
globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  const id = nextId++;
  queue.push({ id, cb });
  return id;
};
globalThis.cancelAnimationFrame = (id: number): void => {
  queue = queue.filter((frame) => frame.id !== id);
};
Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });

function frame(ms = 16): void {
  clock += ms;
  const run = queue;
  queue = [];
  for (const { cb } of run) cb(clock);
}

function painted(el: HTMLElement): IndicatorBox {
  const match = /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\)/.exec(el.style.transform);
  assert.ok(match, `unexpected transform: ${el.style.transform}`);
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    width: Number.parseFloat(el.style.width),
    height: Number.parseFloat(el.style.height),
  };
}

const A: IndicatorBox = { left: 0, top: 4, width: 80, height: 32 };
const B: IndicatorBox = { left: 200, top: 4, width: 120, height: 32 };

function setup(onSettle?: () => void): { el: HTMLElement; engine: LiquidIndicator } {
  queue = [];
  document.documentElement.classList.remove('pf-no-motion');
  const el = document.createElement('span');
  const engine = new LiquidIndicator(el, onSettle);
  return { el, engine };
}

test('jump places the indicator exactly, without animation', () => {
  const { el, engine } = setup();
  engine.jump(A);
  assert.deepEqual(painted(el), A);
  assert.equal(engine.moving, false);
  assert.equal(queue.length, 0);
});

test('springTo stretches toward the target (leading edge first) and settles exactly on it', () => {
  let settled = 0;
  const { el, engine } = setup(() => settled++);
  engine.jump(A);
  engine.springTo(B);
  assert.equal(engine.moving, true);

  let widest = 0;
  for (let i = 0; i < 400 && engine.moving; i++) {
    frame();
    const box = painted(el);
    assert.ok(box.width >= 0, 'the trailing edge never passes the leading one');
    assert.ok(Number.isFinite(box.left) && Number.isFinite(box.width));
    widest = Math.max(widest, box.width);
  }
  assert.equal(engine.moving, false, 'the springs come to rest');
  assert.deepEqual(painted(el), B);
  assert.equal(settled, 1, 'onSettle fires once, on arrival');
  // The leading edge runs ahead of the trailing one: on the way the pill is wider than both ends.
  assert.ok(widest > B.width + 20, `expected a visible stretch, widest was ${widest}`);
});

test('moving left, the left edge leads', () => {
  const { el, engine } = setup();
  engine.jump(B);
  engine.springTo(A);
  frame();
  frame();
  frame();
  const box = painted(el);
  const leftProgress = (B.left - box.left) / (B.left - A.left);
  const rightProgress = (B.left + B.width - (box.left + box.width)) / (B.left + B.width - (A.left + A.width));
  assert.ok(leftProgress > rightProgress, `left ${leftProgress} should lead right ${rightProgress}`);
});

test('moving down a list, the bottom edge leads and the pill stretches vertically', () => {
  const { el, engine } = setup();
  const ROW0: IndicatorBox = { left: 0, top: 0, width: 300, height: 40 };
  const ROW3: IndicatorBox = { left: 0, top: 160, width: 300, height: 40 };
  engine.jump(ROW0);
  engine.springTo(ROW3);
  let tallest = 0;
  for (let i = 0; i < 3; i++) frame();
  const box = painted(el);
  const topProgress = (box.top - ROW0.top) / (ROW3.top - ROW0.top);
  const bottomProgress = (box.top + box.height - 40) / (ROW3.top + 40 - 40);
  assert.ok(bottomProgress > topProgress, `bottom ${bottomProgress} should lead top ${topProgress}`);
  for (let i = 0; i < 400 && engine.moving; i++) {
    frame();
    tallest = Math.max(tallest, painted(el).height);
    assert.equal(painted(el).width, 300, 'the cross axis does not stretch');
  }
  assert.ok(tallest > 60, `expected a vertical stretch, tallest was ${tallest}`);
  assert.deepEqual(painted(el), ROW3);
});

test('a new target mid-flight is taken from the current position, without a jump', () => {
  const { el, engine } = setup();
  engine.jump(A);
  engine.springTo(B);
  for (let i = 0; i < 5; i++) frame();
  const before = painted(el);
  engine.springTo(A);
  frame();
  const after = painted(el);
  // One frame later it is still near where it was (velocity carried, no teleport back to A).
  assert.ok(Math.abs(after.left - before.left) < 40, `jumped from ${before.left} to ${after.left}`);
  for (let i = 0; i < 400 && engine.moving; i++) frame();
  assert.deepEqual(painted(el), A);
});

test('follow tracks the finger directly; release carries its velocity into the spring', () => {
  const { el, engine } = setup();
  engine.jump(A);
  // The finger drags the indicator right at 1px/ms.
  for (let x = 0; x <= 64; x += 16) {
    clock += 16;
    engine.follow({ ...A, left: x });
    assert.equal(painted(el).left, x, 'no lag under the finger');
    assert.equal(engine.moving, false);
  }
  // Released at x=64 with a target at x=64: momentum still pushes it a little further right.
  engine.release({ ...A, left: 64 });
  let furthest = 64;
  for (let i = 0; i < 400 && engine.moving; i++) {
    frame();
    furthest = Math.max(furthest, painted(el).left);
  }
  assert.ok(furthest > 64.5, `expected the carried velocity to overshoot, furthest ${furthest}`);
  assert.deepEqual(painted(el), { ...A, left: 64 });
});

test('with motion turned off, springTo lands at once and still reports arrival', () => {
  let settled = 0;
  const { el, engine } = setup(() => settled++);
  engine.jump(A);
  document.documentElement.classList.add('pf-no-motion');
  engine.springTo(B);
  assert.deepEqual(painted(el), B);
  assert.equal(engine.moving, false);
  assert.equal(settled, 1);
  document.documentElement.classList.remove('pf-no-motion');
});

test('destroy stops the animation frame loop', () => {
  const { engine } = setup();
  engine.jump(A);
  engine.springTo(B);
  assert.equal(queue.length, 1);
  engine.destroy();
  assert.equal(queue.length, 0);
  assert.equal(engine.moving, false);
});
