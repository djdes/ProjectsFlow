import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RichTextEditor } from './RichTextEditor';
import { MotionProvider } from '../motion/MotionProvider';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('внешнее сохранение во время upload не удаляет вставленную картинку', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  let setExternalValue: React.Dispatch<React.SetStateAction<string>> = () => undefined;
  let finishUpload: (url: string | null) => void = () => undefined;
  let uploadedMarkdown = '';
  let uploadedCallbacks = 0;
  const uploadResult = new Promise<string | null>((resolve) => {
    finishUpload = resolve;
  });

  function Harness(): React.ReactElement {
    const [value, setValue] = React.useState('Заголовок');
    setExternalValue = setValue;
    return React.createElement(RichTextEditor, {
      value,
      onChange: setValue,
      onUploadImage: async () => uploadResult,
      onImageUploaded: (markdown: string) => {
        uploadedCallbacks += 1;
        uploadedMarkdown = markdown;
      },
    });
  }

  await act(async () => {
    root.render(React.createElement(MotionProvider, null, React.createElement(Harness)));
  });
  const editor = host.querySelector('.ProseMirror');
  assert.ok(editor, 'редактор смонтирован');

  const screenshot = new File(['image'], 'screenshot.png', { type: 'image/png' });
  const screenshot2 = new File(['image-2'], 'screenshot-2.png', { type: 'image/png' });
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', {
    value: {
      items: [
        { kind: 'file', getAsFile: () => screenshot },
        { kind: 'file', getAsFile: () => screenshot2 },
      ],
      files: [screenshot, screenshot2],
      types: ['Files'],
      getData: () => '',
    },
  });
  await act(async () => {
    editor.dispatchEvent(paste);
  });
  assert.equal(paste.defaultPrevented, true, 'native Ctrl+V is intercepted by the editor');
  assert.ok(host.querySelector('[data-figure-image]'), 'плейсхолдер картинки вставлен');
  assert.equal(
    host.querySelectorAll('[data-figure-image]').length,
    2,
    'native capture and ProseMirror do not insert the same clipboard image twice',
  );
  assert.ok(
    host.querySelector('[data-figure-image] img'),
    'local screenshot preview is visible before upload completes',
  );

  // Имитируем ответ более раннего blur-save/refetch, пока XHR картинки ещё выполняется.
  await act(async () => {
    setExternalValue('Заголовок');
  });
  assert.ok(host.querySelector('[data-figure-image]'), 'плейсхолдер пережил внешнее значение');

  await act(async () => {
    finishUpload('/api/attachments/image-1');
    await uploadResult;
    await Promise.resolve();
  });
  const images = host.querySelectorAll<HTMLImageElement>('[data-figure-image] img');
  assert.equal(images.length, 2);
  assert.equal(images[0]?.getAttribute('src'), '/api/attachments/image-1');
  assert.equal(
    images[0]?.getAttribute('draggable'),
    'true',
    'the screenshot itself moves as a block',
  );
  assert.equal(
    images[0]?.hasAttribute('data-drag-handle'),
    true,
    'Tiptap receives direct image drag events',
  );
  assert.equal(uploadedCallbacks, 1, 'альбом сохраняется одним финальным markdown');
  assert.match(uploadedMarkdown, /<figure data-figure-image>/);
  assert.match(uploadedMarkdown, /src="\/api\/attachments\/image-1"/);

  await act(async () => root.unmount());
  host.remove();
});
