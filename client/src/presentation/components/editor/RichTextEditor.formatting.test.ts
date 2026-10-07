import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { RichTextEditor } from './RichTextEditor';
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('toolbar click/keyboard activation preserves range and applies multiple marks', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let markdown = '';
  function Harness() {
    const [value, setValue] = React.useState('Текст задачи');
    return React.createElement(RichTextEditor, {
      value, toolbar: true, selectionMenu: false,
      onChange: next => { markdown = next; setValue(next); },
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const editor = (host.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor;
    await act(async () => { editor.commands.setTextSelection({ from: 1, to: 6 }); });
    const bold = host.querySelector<HTMLButtonElement>('button[aria-label="Жирный · Ctrl+B"]')!;
    const italic = host.querySelector<HTMLButtonElement>('button[aria-label="Курсив · Ctrl+I"]')!;
    // Keyboard activation emits click without mousedown (the previous menu used mousedown only).
    await act(async () => bold.click());
    await act(async () => italic.click());
    assert.match(editor.getHTML(), /<strong><em>Текст<\/em><\/strong> задачи/);
    assert.equal(bold.getAttribute('aria-pressed'), 'true');
    assert.equal(italic.getAttribute('aria-pressed'), 'true');
    assert.equal(editor.state.selection.to - editor.state.selection.from, 5);
    assert.match(markdown, /Текст/);
    await act(async () => bold.click());
    assert.equal(bold.getAttribute('aria-pressed'), 'false');
    assert.match(editor.getHTML(), /<em>Текст<\/em> задачи/);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test('read-only task editor exposes no formatting controls', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(RichTextEditor, { value: '**Текст**', disabled: true, toolbar: true, onChange: () => undefined })));
  assert.equal(host.querySelector('[role="toolbar"]'), null);
  assert.equal(host.querySelector('.tiptap')?.getAttribute('contenteditable'), 'false');
  assert.match(host.innerHTML, /<strong>Текст<\/strong>/);
  await act(async () => root.unmount()); host.remove();
});
