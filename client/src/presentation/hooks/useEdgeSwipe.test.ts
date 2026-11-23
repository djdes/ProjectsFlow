import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useEdgeSwipe } from './useEdgeSwipe';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function touch(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  document.body.dispatchEvent(event);
  return event;
}

async function mount(): Promise<{ opened: () => number; unmount: () => Promise<void> }> {
  let opens = 0;
  function Harness(): null {
    useEdgeSwipe({ enabled: true, open: false, onOpen: () => opens++, onClose: () => undefined });
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Harness)));
  return {
    opened: () => opens,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('a vertical move that starts at the very edge scrolls the page', async () => {
  const view = await mount();
  try {
    touch('touchstart', 6, 300);
    assert.equal(touch('touchmove', 6.5, 306).defaultPrevented, false, 'first move clearly vertical: scroll');
    assert.equal(touch('touchmove', 9, 340).defaultPrevented, false, 'the rest of that gesture stays a scroll');
    touch('touchend', 9, 340);
  } finally {
    await view.unmount();
  }
});

test('a sideways move at the edge is held from the first frame and opens the panel', async () => {
  const view = await mount();
  try {
    touch('touchstart', 6, 300);
    assert.equal(touch('touchmove', 12, 301).defaultPrevented, true, 'the system back swipe never starts');
    assert.equal(touch('touchmove', 80, 305).defaultPrevented, true);
    touch('touchend', 80, 305);
    assert.equal(view.opened(), 1);
  } finally {
    await view.unmount();
  }
});

test('touches away from the edges are left alone', async () => {
  const view = await mount();
  try {
    touch('touchstart', 200, 300);
    assert.equal(touch('touchmove', 260, 302).defaultPrevented, false);
    touch('touchend', 260, 302);
    assert.equal(view.opened(), 0);
  } finally {
    await view.unmount();
  }
});
