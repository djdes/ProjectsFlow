import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import {
  buildTaskTelegramContent,
  buildTaskTelegramRichContent,
} from './taskTelegramContent.js';

function attachment(id: string, filename: string, mimeType: string): TaskAttachment {
  return {
    id,
    taskId: 'task-1',
    commentId: null,
    filename,
    mimeType,
    sizeBytes: 100,
    storageKey: `${id}.bin`,
    uploadedAt: new Date('2026-07-15T10:00:00Z'),
  };
}

const resolveUrl = (id: string): string => `https://pf.test/api/attachments/${id}?signed=1`;

test('скрин из абзаца остаётся между текстом, обычные файлы идут после описания', () => {
  const parts = buildTaskTelegramContent(
    [
      '# Заголовок',
      '',
      'Текст до скрина',
      '',
      '<figure data-figure-image><img src="/api/attachments/img-1" alt="" /></figure>',
      '',
      'Текст после скрина',
    ].join('\n'),
    [
      attachment('img-1', 'screenshot.png', 'image/png'),
      attachment('audio-1', 'voice.mp3', 'audio/mpeg'),
      attachment('doc-1', 'brief.pdf', 'application/pdf'),
    ],
    resolveUrl,
  );

  assert.deepEqual(parts.map((part) => part.kind), [
    'text',
    'attachment',
    'text',
    'text',
    'attachment',
    'attachment',
  ]);
  assert.match(parts[0]!.kind === 'text' ? parts[0]!.html : '', /Текст до скрина/);
  assert.equal(parts[1]!.kind === 'attachment' ? parts[1]!.attachmentId : '', 'img-1');
  assert.equal(parts[1]!.kind === 'attachment' ? parts[1]!.inline : false, true);
  assert.match(parts[2]!.kind === 'text' ? parts[2]!.html : '', /Текст после скрина/);
  assert.equal(parts[3]!.kind === 'text' ? parts[3]!.html : '', '<b>📎 Файлы</b>');
  assert.deepEqual(
    parts
      .filter((part) => part.kind === 'attachment' && !part.inline)
      .map((part) => part.attachmentId),
    ['audio-1', 'doc-1'],
  );
});

test('figure внутри блока кода не становится встроенной картинкой', () => {
  const parts = buildTaskTelegramContent(
    '```html\n<figure data-figure-image><img src="/api/attachments/img-1"></figure>\n```',
    [attachment('img-1', 'screenshot.png', 'image/png')],
    resolveUrl,
  );

  assert.equal(parts[0]!.kind, 'text');
  assert.match(parts[0]!.kind === 'text' ? parts[0]!.html : '', /&lt;figure/);
  assert.equal(parts.filter((part) => part.kind === 'attachment' && part.inline).length, 0);
});

test('очень длинный текст разбивается на допустимые Telegram-сообщения', () => {
  const parts = buildTaskTelegramContent('<'.repeat(5_000), [], resolveUrl);
  const texts = parts.filter((part) => part.kind === 'text');
  assert.ok(texts.length > 1);
  assert.ok(texts.every((part) => part.html.length <= 3_200));
});

test('rich content keeps a pasted screenshot between its surrounding paragraphs', () => {
  const parts = buildTaskTelegramContent(
    [
      'До скриншота',
      '<figure data-figure-image><img src="/api/attachments/img-1" alt="" /></figure>',
      'После скриншота',
    ].join('\n'),
    [
      attachment('img-1', 'screenshot.png', 'image/png'),
      attachment('doc-1', 'brief.pdf', 'application/pdf'),
    ],
    resolveUrl,
  );

  const rich = buildTaskTelegramRichContent(parts);
  assert.ok(rich);
  assert.match(rich.html, /<p>До скриншота<\/p>/);
  assert.match(rich.html, /<p>После скриншота<\/p>/);
  assert.ok(rich.html.indexOf('До скриншота') < rich.html.indexOf('tg://photo?id=task_photo_1'));
  assert.ok(rich.html.indexOf('tg://photo?id=task_photo_1') < rich.html.indexOf('После скриншота'));
  assert.deepEqual(rich.media, [
    {
      id: 'task_photo_1',
      kind: 'photo',
      url: resolveUrl('img-1'),
      attachmentId: 'img-1',
      filename: 'screenshot.png',
      mimeType: 'image/png',
    },
  ]);
  assert.equal(parts[rich.consumedParts]!.kind, 'text');
  assert.equal(
    parts[rich.consumedParts]!.kind === 'text'
      ? parts[rich.consumedParts]!.section
      : '',
    'attachments_heading',
  );
});
