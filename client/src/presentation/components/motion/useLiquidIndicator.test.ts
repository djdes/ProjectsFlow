import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useLiquidIndicator } from './useLiquidIndicator';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Layout comes from data attributes (happy-dom has no layout): x / width of each element.
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
  const x = Number(this.dataset.x ?? 0);
  const w = Number(this.dataset.w ?? 0);
  const h = w ? 30 : 0;
  return { left: x, top: 0, right: x + w, bottom: h, width: w, height: h, x, y: 0, toJSON: () => ({}) } as DOMRect;
};

// The engine plays its moves through the Web Animations API; the fake records them and lets
// a test finish them (the element already rests on the target under a running move).
const moves: Array<{ el: Element; onfinish: null | (() => void); cancel: () => void }> = [];
HTMLElement.prototype.animate = function (this: HTMLElement) {
  const move = { el: this, onfinish: null as null | (() => void), currentTime: 0, cancel() {} };
  moves.push(move);
  return move as unknown as Animation;
};
function settle(): void {
  for (const move of moves.splice(0)) move.onfinish?.();
}

function left(el: HTMLElement | null): number {
  const match = /translate3d\(([-\d.]+)px/.exec(el?.style.transform ?? '');
  assert.ok(match, `indicator not painted: "${el?.style.transform}"`);
  return Number(match[1]);
}

function Tabs({ value, variant }: { value: number; variant: string }): React.ReactElement {
  const rail = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useLiquidIndicator({ containerRef: rail, indicatorRef: pill, activeSelector: '[aria-pressed="true"]', activeKey: `${variant}:${value}` });
  return React.createElement(
    'div',
    { ref: rail, 'data-x': 0, 'data-w': 300 },
    // A different variant mounts a new indicator element (another layout branch).
    React.createElement('span', { key: variant, ref: pill, 'data-pill': variant }),
    [0, 1, 2].map((i) =>
      React.createElement('button', { key: i, 'aria-pressed': i === value, 'data-x': i * 100, 'data-w': 100 }, `Tab ${i}`),
    ),
  );
}

test('the indicator lands on the selected tab, then flows to a new selection', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Tabs, { value: 0, variant: 'a' })));
  const pill = host.querySelector<HTMLElement>('[data-pill]');
  assert.equal(left(pill), 0);
  assert.equal(pill?.style.opacity, '1');

  moves.length = 0;
  await act(async () => root.render(React.createElement(Tabs, { value: 2, variant: 'a' })));
  assert.ok(moves.some((move) => move.el === pill), 'a new selection animates');
  settle();
  assert.equal(left(pill), 200);
  assert.equal(Number.parseFloat(pill?.style.width ?? ''), 100);
  await act(async () => root.unmount());
  host.remove();
});

test('a re-created indicator element gets its own engine', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Tabs, { value: 0, variant: 'a' })));
  settle();
  await act(async () => root.render(React.createElement(Tabs, { value: 1, variant: 'b' })));
  settle();
  const pill = host.querySelector<HTMLElement>('[data-pill="b"]');
  // The new element is painted on the selected tab right away (no flight from nowhere).
  assert.equal(left(pill), 100);
  assert.equal(pill?.style.opacity, '1');
  await act(async () => root.render(React.createElement(Tabs, { value: 2, variant: 'b' })));
  settle();
  assert.equal(left(pill), 200);
  await act(async () => root.unmount());
  host.remove();
});
