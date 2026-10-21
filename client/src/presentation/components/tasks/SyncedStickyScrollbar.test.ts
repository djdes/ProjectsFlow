import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SyncedStickyScrollbar } from './SyncedStickyScrollbar';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observed = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
  observe(element: Element): void { this.observed.add(element); }
  unobserve(element: Element): void { this.observed.delete(element); }
  disconnect(): void { this.observed.clear(); }
  fire(): void { this.callback([], this as unknown as ResizeObserver); }
}
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });

function row(clientWidth = 320, scrollWidth = 1200, initialLeft = 0) {
  const element = document.createElement('div');
  const column = document.createElement('div');
  element.append(column);
  document.body.append(element);
  const size = { clientWidth, scrollWidth };
  let left = initialLeft;
  Object.defineProperties(element, {
    clientWidth: { get: () => size.clientWidth },
    scrollWidth: { get: () => size.scrollWidth },
    scrollLeft: {
      get: () => left,
      set: (value: number) => { left = Math.max(0, Math.min(value, size.scrollWidth - size.clientWidth)); },
    },
  });
  return { element, column, size };
}

async function mount(target: HTMLElement | null, ctrlWheel = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (next: HTMLElement | null): Promise<void> => {
    await act(async () => root.render(React.createElement(SyncedStickyScrollbar, { target: next, ctrlWheel })));
  };
  await render(target);
  return {
    host,
    render,
    track() { return host.querySelector<HTMLDivElement>('[aria-hidden] > div'); },
    async close() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function wheel(element: HTMLElement, options: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
  // happy-dom's WheelEvent extends UIEvent and omits MouseEvent modifier keys.
  Object.defineProperty(event, 'ctrlKey', { value: options.ctrlKey ?? false });
  element.dispatchEvent(event);
  return event;
}

test('connects to a row that appears after loading and restores its position', async () => {
  const view = await mount(null);
  const target = row(320, 1200, 427);
  try {
    assert.equal(view.track(), null);
    await view.render(target.element);
    assert.equal(view.track()?.style.width, '320px');
    assert.equal(view.track()?.scrollLeft, 427);
    target.element.scrollLeft = 600;
    target.element.dispatchEvent(new Event('scroll'));
    assert.equal(view.track()?.scrollLeft, 600);
  } finally {
    await view.close();
    target.element.remove();
  }
});

test('reconnects after filtering replaces the row, and drops old listeners', async () => {
  const first = row(320, 1200, 80);
  const second = row(240, 900, 150);
  const view = await mount(first.element, true);
  try {
    await view.render(second.element);
    assert.equal(view.track()?.scrollLeft, 150);
    assert.equal(view.track()?.style.width, '240px');
    first.element.scrollLeft = 600;
    first.element.dispatchEvent(new Event('scroll'));
    assert.equal(view.track()?.scrollLeft, 150);
    assert.equal(wheel(first.element, { ctrlKey: true, deltaY: 80 }).defaultPrevented, false);
    second.element.scrollLeft = 300;
    second.element.dispatchEvent(new Event('scroll'));
    assert.equal(view.track()?.scrollLeft, 300);
    await view.render(null);
    assert.equal(view.track(), null);
    assert.equal(wheel(second.element, { ctrlKey: true, deltaY: 80 }).defaultPrevented, false);
  } finally {
    await view.close();
    first.element.remove();
    second.element.remove();
  }
});

test('synchronizes both directions without discarding rapid scroll events', async () => {
  const target = row();
  const view = await mount(target.element);
  try {
    const track = view.track()!;
    track.scrollLeft = 100;
    track.dispatchEvent(new Event('scroll'));
    assert.equal(target.element.scrollLeft, 100);
    target.element.scrollLeft = 250;
    target.element.dispatchEvent(new Event('scroll'));
    assert.equal(track.scrollLeft, 250);
    track.scrollLeft = 880;
    track.dispatchEvent(new Event('scroll'));
    assert.equal(target.element.scrollLeft, 880);
    target.element.scrollLeft = 0;
    target.element.dispatchEvent(new Event('scroll'));
    assert.equal(track.scrollLeft, 0);
  } finally {
    await view.close();
    target.element.remove();
  }
});

test('a delayed row scroll event cannot pull a scrollbar being dragged back to an older position', async () => {
  const target = row();
  const view = await mount(target.element);
  try {
    const track = view.track()!;
    for (const [previous, next] of [[100, 240], [240, 500], [500, 300], [300, 80]]) {
      track.scrollLeft = previous;
      track.dispatchEvent(new Event('scroll'));
      // Native dragging moves the thumb before the queued scroll events are delivered.
      track.scrollLeft = next;
      target.element.dispatchEvent(new Event('scroll'));
      assert.equal(track.scrollLeft, next, 'the row must not undo the latest thumb movement');
      track.dispatchEvent(new Event('scroll'));
      assert.equal(target.element.scrollLeft, next);
    }
  } finally {
    await view.close();
    target.element.remove();
  }
});

test('updating task content during a thumb drag does not reset its position', async () => {
  const target = row();
  const view = await mount(target.element);
  try {
    const track = view.track()!;
    track.scrollLeft = 100;
    track.dispatchEvent(new Event('scroll'));
    track.scrollLeft = 300;
    await act(async () => {
      target.column.append(document.createElement('span'));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(track.scrollLeft, 300);
    // More than one notification for the same programmatic position is harmless.
    target.element.dispatchEvent(new Event('scroll'));
    target.element.dispatchEvent(new Event('scroll'));
    assert.equal(track.scrollLeft, 300);
    track.dispatchEvent(new Event('scroll'));
    assert.equal(target.element.scrollLeft, 300);
  } finally {
    await view.close();
    target.element.remove();
  }
});

test('a delayed scrollbar event cannot undo a newer scroll in the row', async () => {
  const target = row();
  const view = await mount(target.element);
  try {
    const track = view.track()!;
    target.element.scrollLeft = 100;
    target.element.dispatchEvent(new Event('scroll'));
    target.element.scrollLeft = 300;
    track.dispatchEvent(new Event('scroll'));
    assert.equal(target.element.scrollLeft, 300);
    target.element.dispatchEvent(new Event('scroll'));
    assert.equal(track.scrollLeft, 300);
  } finally {
    await view.close();
    target.element.remove();
  }
});

test('remeasures columns and shows/hides the track as overflow changes', async () => {
  const target = row();
  const view = await mount(target.element);
  const observer = TestResizeObserver.instances.at(-1)!;
  try {
    assert.ok(observer.observed.has(target.column));
    await act(async () => {
      target.size.scrollWidth = 300;
      observer.fire();
    });
    assert.equal(view.track(), null);
    await act(async () => {
      target.size.clientWidth = 220;
      target.size.scrollWidth = 900;
      observer.fire();
    });
    assert.equal(view.track()?.style.width, '220px');
    const newColumn = document.createElement('div');
    await act(async () => {
      target.element.append(newColumn);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.ok(observer.observed.has(newColumn));
  } finally {
    await view.close();
    assert.equal(observer.observed.size, 0);
    target.element.remove();
  }
});

test('Ctrl + wheel scrolls the queue horizontally, including line and page deltas', async () => {
  const target = row();
  const view = await mount(target.element, true);
  try {
    assert.equal(wheel(target.element, { ctrlKey: true, deltaY: 80 }).defaultPrevented, true);
    assert.equal(target.element.scrollLeft, 80);
    wheel(target.element, { ctrlKey: true, deltaY: -30 });
    assert.equal(target.element.scrollLeft, 50);
    wheel(target.element, { ctrlKey: true, deltaX: 10 });
    assert.equal(target.element.scrollLeft, 60);
    wheel(target.element, { ctrlKey: true, deltaY: 3, deltaMode: 1 });
    assert.equal(target.element.scrollLeft, 108);
    wheel(target.element, { ctrlKey: true, deltaY: 1, deltaMode: 2 });
    assert.equal(target.element.scrollLeft, 428);
    target.element.dispatchEvent(new Event('scroll'));
    assert.equal(view.track()?.scrollLeft, 428);
    // Reaching an edge must not unexpectedly switch the gesture back to browser zoom.
    wheel(target.element, { ctrlKey: true, deltaY: 1000 });
    assert.equal(target.element.scrollLeft, 880);
    assert.equal(wheel(target.element, { ctrlKey: true, deltaY: 80 }).defaultPrevented, true);
    assert.equal(target.element.scrollLeft, 880);
  } finally {
    await view.close();
    target.element.remove();
  }
});

test('leaves ordinary wheel events and non-overflowing rows to the browser', async () => {
  const target = row();
  const view = await mount(target.element, true);
  try {
    assert.equal(wheel(target.element, { deltaY: 80 }).defaultPrevented, false);
    assert.equal(target.element.scrollLeft, 0);
    assert.equal(wheel(target.element, { ctrlKey: true }).defaultPrevented, false);
    target.size.scrollWidth = 300;
    assert.equal(wheel(target.element, { ctrlKey: true, deltaY: 80 }).defaultPrevented, false);
  } finally {
    await view.close();
    target.element.remove();
  }
});

test('Ctrl + wheel is opt-in and is detached on unmount', async () => {
  const target = row();
  const view = await mount(target.element);
  try {
    assert.equal(wheel(target.element, { ctrlKey: true, deltaY: 80 }).defaultPrevented, false);
    assert.equal(target.element.scrollLeft, 0);
  } finally {
    await view.close();
  }
  const enabled = await mount(target.element, true);
  await enabled.close();
  assert.equal(wheel(target.element, { ctrlKey: true, deltaY: 80 }).defaultPrevented, false);
  assert.equal(target.element.scrollLeft, 0);
  target.element.remove();
});
