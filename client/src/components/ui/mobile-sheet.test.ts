import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useMobileSheetSurface } from './mobile-sheet';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test('swipe uses the existing close callback, preserves a rejected close, and cancels cleanly', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let requests = 0;
  function Harness() {
    const { ref: surfaceRef, closeRef } = useMobileSheetSurface(true);
    return React.createElement(
      'div',
      { ref: surfaceRef, 'data-pf-mobile-sheet': 'true', 'data-state': 'open' },
      React.createElement(
        'button',
        {
          ref: closeRef,
          'data-pf-sheet-handle': '',
          onClick: () => requests++,
        },
        'Закрыть',
      ),
      React.createElement('input', { defaultValue: 'Несохранённый черновик' }),
    );
  }
  await act(async () => root.render(React.createElement(Harness)));
  const sheet = host.firstElementChild as HTMLElement;
  const handle = sheet.querySelector('button')!;
  const touch = (type: string, x: number, y: number, count = 1): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
      value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
    });
    handle.dispatchEvent(event);
  };
  try {
    await act(async () => {
      touch('touchstart', 100, 100);
      touch('touchmove', 100, 250);
      touch('touchend', 100, 250, 0);
    });
    assert.equal(requests, 1);
    assert.equal(sheet.style.getPropertyValue('--pf-sheet-y'), '0px');
    assert.equal(sheet.querySelector('input')?.value, 'Несохранённый черновик');
    await act(async () => {
      touch('touchstart', 100, 100);
      touch('touchmove', 100, 240);
      touch('touchcancel', 100, 240, 0);
    });
    assert.equal(requests, 1);
    assert.equal(sheet.hasAttribute('data-pf-sheet-dragging'), false);
    await act(async () => {
      touch('touchstart', 100, 100);
      touch('touchmove', 240, 104);
      touch('touchend', 240, 104, 0);
      touch('touchstart', 100, 100);
      touch('touchmove', 100, 240, 2);
      touch('touchend', 100, 240, 0);
    });
    assert.equal(requests, 1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
