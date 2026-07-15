import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClipboardFiles, isMp4File } from './files';

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

test('extractClipboardFiles converts an HTML data URL screenshot to a File', () => {
  const data = {
    items: [],
    files: [],
    getData: (type: string) =>
      type === 'text/html'
        ? '<p>clipboard</p><img src="data:image/png;base64,cG5n" alt="screenshot">'
        : '',
  } as unknown as DataTransfer;

  const [file] = extractClipboardFiles(data);
  assert.ok(file);
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'pasted-image-1.png');
  assert.equal(file.size, 3);
});

test('isMp4File recognizes MP4 by MIME or filename fallback', () => {
  assert.equal(isMp4File('video/mp4', 'recording.bin'), true);
  assert.equal(isMp4File('VIDEO/MP4; codecs=avc1', 'recording.bin'), true);
  assert.equal(isMp4File('application/octet-stream', 'recording.MP4'), true);
  assert.equal(isMp4File('', 'recording.mp4'), true);
});

test('isMp4File does not treat other video and document formats as MP4', () => {
  assert.equal(isMp4File('video/webm', 'recording.webm'), false);
  assert.equal(isMp4File('application/pdf', 'recording.pdf'), false);
});
