import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClipboardFiles } from './files';

function clipboard(items: File[], files: File[]): DataTransfer {
  return {
    items: items.map((file) => ({ kind: 'file', getAsFile: () => file })),
    files,
  } as unknown as DataTransfer;
}

test('extractClipboardFiles читает скрин из clipboardData.files', () => {
  const screenshot = new File(['png'], 'screenshot.png', { type: 'image/png' });
  assert.deepEqual(extractClipboardFiles(clipboard([], [screenshot])), [screenshot]);
});

test('extractClipboardFiles объединяет items и files без дублей', () => {
  const screenshot = new File(['png'], 'screenshot.png', { type: 'image/png' });
  const screenshotCopy = new File(['png'], 'screenshot.png', {
    type: 'image/png',
    lastModified: screenshot.lastModified,
  });
  const document = new File(['pdf'], 'brief.pdf', { type: 'application/pdf' });
  assert.deepEqual(
    extractClipboardFiles(clipboard([screenshot], [screenshotCopy, document])),
    [screenshot, document],
  );
});
