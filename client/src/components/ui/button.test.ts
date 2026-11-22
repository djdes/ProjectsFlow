import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from './button';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: a button is as wide as its text (10px per character).
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return (this.textContent ?? '').length * 10;
  },
});
const animations: Array<{ el: Element; keyframes: Keyframe[] }> = [];
HTMLElement.prototype.animate = function (this: HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes | null) {
  animations.push({ el: this, keyframes: keyframes as Keyframe[] });
  return { onfinish: null, oncancel: null, cancel() {} } as unknown as Animation;
};

async function mount(element: React.ReactElement): Promise<{ host: HTMLElement; render: (el: React.ReactElement) => Promise<void>; unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    render: async (el) => act(async () => root.render(el)),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('a new label blurs in and the width springs from the old label to the new one', async () => {
  animations.length = 0;
  const view = await mount(React.createElement(Button, null, 'Войти'));
  const button = view.host.querySelector('button')!;
  assert.equal(button.querySelector('.pf-button-label')?.hasAttribute('data-pf-swap'), false, 'no swap effect on first render');
  assert.equal(animations.length, 0);

  await view.render(React.createElement(Button, null, 'Входим в аккаунт…'));
  const label = button.querySelector('.pf-button-label')!;
  assert.equal(label.textContent, 'Входим в аккаунт…');
  assert.equal(label.hasAttribute('data-pf-swap'), true, 'the new label plays its entrance');
  assert.equal(animations.length, 1, 'one width animation');
  assert.deepEqual(animations[0]!.keyframes, [{ width: '50px' }, { width: '170px' }]);

  // Same label again: nothing replays.
  await view.render(React.createElement(Button, null, 'Входим в аккаунт…'));
  assert.equal(animations.length, 1);
  await view.unmount();
});

test('loading shows a spinner and marks the button busy', async () => {
  const view = await mount(React.createElement(Button, { loading: true }, 'Сохраняем…'));
  const button = view.host.querySelector('button')!;
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.ok(button.querySelector('.pf-button-spinner'), 'spinner is rendered');
  await view.render(React.createElement(Button, { loading: false }, 'Сохранить'));
  assert.equal(button.hasAttribute('aria-busy'), false);
  assert.equal(button.querySelector('.pf-button-spinner'), null);
  await view.unmount();
});

test('asChild keeps the child as is, without the label wrapper', async () => {
  const view = await mount(React.createElement(Button, { asChild: true }, React.createElement('a', { href: '/x' }, 'Открыть')));
  const link = view.host.querySelector('a')!;
  assert.ok(link.classList.contains('pf-button'));
  assert.equal(link.querySelector('.pf-button-label'), null);
  assert.equal(link.textContent, 'Открыть');
  await view.unmount();
});

test('a ref passed to the button still receives the element', async () => {
  const ref = React.createRef<HTMLButtonElement>();
  const view = await mount(React.createElement(Button, { ref }, 'Ок'));
  assert.equal(ref.current, view.host.querySelector('button'));
  await view.unmount();
});
