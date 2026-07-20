import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerProvider } from '@/infrastructure/di/container';
import { AiComposer, type AiComposerMode } from './AiComposer';

// tsx компилирует .tsx классическим JSX-рантаймом — React должен быть глобальным
// (тот же приём, что в RichTextEditor.paste.test.ts).
(globalThis as typeof globalThis & { React: typeof React }).React = React;

type ComposerProps = Parameters<typeof AiComposer>[0];

type Rendered = {
  host: HTMLElement;
  editable: HTMLElement;
  sendButton: HTMLButtonElement;
  modeToggle: HTMLButtonElement;
  type: (text: string) => Promise<void>;
  press: (key: string) => Promise<void>;
  click: (element: HTMLElement) => Promise<void>;
  rerender: (next: ComposerProps) => Promise<void>;
  unmount: () => Promise<void>;
};

async function render(props: ComposerProps): Promise<Rendered> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const draw = async (next: ComposerProps): Promise<void> => {
    await act(async () => {
      root.render(React.createElement(ContainerProvider, null, React.createElement(AiComposer, next)));
    });
  };
  await draw(props);
  // Все геттеры перечитывают DOM: часть тестов проверяет именно то, что узлы переживают
  // перерисовку, и закешированная ссылка такую проверку обессмыслила бы.
  const editable = (): HTMLElement => host.querySelector('[role="textbox"]') as HTMLElement;
  return {
    host,
    get editable() { return editable(); },
    get sendButton() { return host.querySelector('button[aria-label="Отправить"]') as HTMLButtonElement; },
    get modeToggle() { return host.querySelector('button[aria-pressed]') as HTMLButtonElement; },
    type: async (text: string) => {
      editable().textContent = text;
      await act(async () => { editable().dispatchEvent(new Event('input', { bubbles: true })); });
    },
    press: async (key: string) => {
      await act(async () => { editable().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    },
    click: async (element: HTMLElement) => {
      await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    },
    rerender: draw,
    unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); },
  };
}

function withMode(mode: AiComposerMode, onChange: (next: AiComposerMode) => void, buildEnabled = true): ComposerProps {
  return {
    conversationId: 'conv-mode',
    sending: false,
    onSend: async () => undefined,
    modeSwitch: { mode, onChange, buildEnabled },
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

test('без выделенной зоны режим «Правка» выключен, а не ломается при отправке', async () => {
  const view = await render(withMode('discuss', () => undefined, false));
  assert.equal(view.modeToggle.disabled, true);
  assert.equal(view.modeToggle.getAttribute('aria-pressed'), 'false');
  await view.unmount();
});

test('тумблер меняет только плейсхолдер и нажатое состояние', async () => {
  const changed: AiComposerMode[] = [];
  const view = await render(withMode('discuss', (next) => changed.push(next)));
  assert.match(view.host.textContent ?? '', /Что обсудим/);

  await view.click(view.modeToggle);
  assert.deepEqual(changed, ['build']);

  await view.rerender(withMode('build', (next) => changed.push(next)));
  assert.match(view.host.textContent ?? '', /Что изменить в выделенной зоне/);
  assert.equal(view.modeToggle.getAttribute('aria-pressed'), 'true');
  await view.unmount();
});

test('переключение режима не трогает набранный черновик и не пересоздаёт поле', async () => {
  const view = await render(withMode('discuss', () => undefined));
  await view.type('уже набранный черновик');
  const before = view.editable;

  await view.rerender(withMode('build', () => undefined));
  assert.equal(view.editable, before, 'поле ввода не должно перемонтироваться при смене режима');
  assert.equal(view.editable.textContent, 'уже набранный черновик');
  await view.unmount();
});

test('отправка уходит с выбранным режимом', async () => {
  const sent: Array<[string, AiComposerMode]> = [];
  const view = await render({
    ...withMode('build', () => undefined),
    onSend: async (body, mode) => { sent.push([body, mode]); },
  });

  await view.type('сделай заголовок жирным');
  await view.click(view.sendButton);
  assert.deepEqual(sent, [['сделай заголовок жирным', 'build']]);
  await view.unmount();
});

test('подсказка заполняет поле по токену и не отправляет сообщение', async () => {
  const sent: string[] = [];
  const base: ComposerProps = {
    conversationId: 'conv-insert',
    sending: false,
    onSend: async (body) => { sent.push(body); },
  };
  const view = await render(base);
  await view.rerender({ ...base, insert: { text: 'длинный промпт из подсказки', token: 1 } });
  assert.equal(view.editable.textContent, 'длинный промпт из подсказки');
  assert.equal(sent.length, 0);

  // Тот же текст с новым токеном обязан примениться снова — иначе повторный клик по
  // чипу после ручной правки поля ничего не делал бы.
  await view.type('стёр и написал своё');
  await view.rerender({ ...base, insert: { text: 'длинный промпт из подсказки', token: 2 } });
  assert.equal(view.editable.textContent, 'длинный промпт из подсказки');
  await view.unmount();
});
