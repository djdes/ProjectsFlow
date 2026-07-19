import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerProvider } from '@/infrastructure/di/container';
import { AiComposer } from './AiComposer';

// tsx компилирует .tsx классическим JSX-рантаймом — React должен быть глобальным
// (тот же приём, что в RichTextEditor.paste.test.ts).
(globalThis as typeof globalThis & { React: typeof React }).React = React;

type Rendered = {
  editable: HTMLElement;
  sendButton: HTMLButtonElement;
  type: (text: string) => Promise<void>;
  press: (key: string) => Promise<void>;
  click: (element: HTMLElement) => Promise<void>;
  unmount: () => Promise<void>;
};

async function render(props: Parameters<typeof AiComposer>[0]): Promise<Rendered> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(ContainerProvider, null, React.createElement(AiComposer, props)));
  });
  const editable = host.querySelector('[role="textbox"]') as HTMLElement;
  const query = (): HTMLButtonElement => host.querySelector('button[aria-label="Отправить"]') as HTMLButtonElement;
  return {
    editable,
    get sendButton() { return query(); },
    type: async (text: string) => {
      editable.textContent = text;
      await act(async () => { editable.dispatchEvent(new Event('input', { bubbles: true })); });
    },
    press: async (key: string) => {
      await act(async () => { editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    },
    click: async (element: HTMLElement) => {
      await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    },
    unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); },
  };
}

test('Enter не отправляет сообщение — отправка только кнопкой', async () => {
  const sent: string[] = [];
  const view = await render({
    conversationId: 'conv-enter',
    sending: false,
    onSend: async (body) => { sent.push(body); },
  });

  await view.type('черновик ответа');
  await view.press('Enter');
  assert.deepEqual(sent, []);

  await view.click(view.sendButton);
  assert.deepEqual(sent, ['черновик ответа']);
  await view.unmount();
});

test('кнопка отправки неактивна на пустом и пробельном вводе', async () => {
  const view = await render({
    conversationId: 'conv-disabled',
    sending: false,
    onSend: async () => undefined,
  });

  assert.equal(view.sendButton.disabled, true);
  await view.type('   \n  ');
  assert.equal(view.sendButton.disabled, true);
  await view.type('вопрос');
  assert.equal(view.sendButton.disabled, false);
  await view.unmount();
});

test('черновик переживает размонтирование композера', async () => {
  const first = await render({ conversationId: 'conv-draft', sending: false, onSend: async () => undefined });
  await first.type('незаконченная мысль');
  await first.unmount();

  const second = await render({ conversationId: 'conv-draft', sending: false, onSend: async () => undefined });
  assert.equal(second.editable.textContent, 'незаконченная мысль');
  assert.equal(second.sendButton.disabled, false);
  await second.unmount();
});
