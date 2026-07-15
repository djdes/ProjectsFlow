import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import {
  buildTaskTelegramContent,
  buildTaskTelegramFallbackContent,
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
      attachment('video-1', 'demo.mp4', 'video/mp4'),
      attachment('audio-1', 'track.mp3', 'audio/mpeg'),
      attachment('doc-1', 'brief.pdf', 'application/pdf'),
    ],
    resolveUrl,
  );

  const rich = buildTaskTelegramRichContent(
    parts,
    '<footer><a href="https://pf.test/tasks/task-1">Открыть задачу</a></footer>',
  );
  assert.ok(rich);
  assert.match(rich.html, /<p>До скриншота<\/p>/);
  assert.match(rich.html, /<p>После скриншота<\/p>/);
  assert.ok(rich.html.indexOf('До скриншота') < rich.html.indexOf('tg://photo?id=task_photo_1'));
  assert.ok(rich.html.indexOf('tg://photo?id=task_photo_1') < rich.html.indexOf('После скриншота'));
  assert.deepEqual(
    rich.media.map(({ id, kind, attachmentId }) => ({ id, kind, attachmentId })),
    [
      { id: 'task_photo_1', kind: 'photo', attachmentId: 'img-1' },
      { id: 'task_video_2', kind: 'video', attachmentId: 'video-1' },
      { id: 'task_audio_3', kind: 'audio', attachmentId: 'audio-1' },
    ],
  );
  assert.match(rich.html, /tg:\/\/video\?id=task_video_2/);
  assert.match(rich.html, /tg:\/\/audio\?id=task_audio_3/);
  assert.match(rich.html, /<a href="https:\/\/pf\.test\/api\/attachments\/doc-1\?signed=1">brief\.pdf<\/a>/);
  assert.match(rich.html, /Открыть задачу/);
  assert.equal(rich.consumedParts, parts.length);
});

test('unsupported and oversized files stay as links in the single rich message', () => {
  const oversizedPhoto = {
    ...attachment('photo-1', 'huge.png', 'image/png'),
    sizeBytes: 10 * 1024 * 1024 + 1,
  };
  const parts = buildTaskTelegramContent(
    'Описание',
    [
      oversizedPhoto,
      attachment('archive-1', 'sources.zip', 'application/zip'),
    ],
    resolveUrl,
  );

  const rich = buildTaskTelegramRichContent(parts);
  assert.ok(rich);
  assert.equal(rich.media.length, 0);
  assert.match(rich.html, />huge\.png<\/a>/);
  assert.match(rich.html, />sources\.zip<\/a>/);
});

test('regular MP4 and audio attachments produce one rich card even without an inline screenshot', () => {
  const parts = buildTaskTelegramContent(
    'Только описание',
    [
      attachment('video-1', 'demo.mp4', 'video/mp4'),
      attachment('audio-1', 'track.m4a', 'audio/mp4'),
    ],
    resolveUrl,
  );

  const rich = buildTaskTelegramRichContent(parts);
  assert.ok(rich);
  assert.deepEqual(rich.media.map((item) => item.kind), ['video', 'audio']);
  assert.match(rich.html, /Только описание/);
  assert.match(rich.html, /demo\.mp4/);
  assert.match(rich.html, /track\.m4a/);
});

test('repeated inline references reuse one upload while preserving both positions', () => {
  const figure = '<figure data-figure-image><img src="/api/attachments/img-1" alt="" /></figure>';
  const parts = buildTaskTelegramContent(
    ['До', figure, 'Между', figure, 'После'].join('\n'),
    [attachment('img-1', 'screen.png', 'image/png')],
    resolveUrl,
  );

  const rich = buildTaskTelegramRichContent(parts);
  assert.ok(rich);
  assert.equal(rich.media.length, 1);
  assert.equal(rich.html.match(/tg:\/\/photo\?id=task_photo_1/g)?.length, 2);
});

test('the 51st rich media and media beyond the aggregate upload budget remain links', () => {
  const photos = Array.from({ length: 51 }, (_, index) =>
    attachment(`photo-${index}`, `photo-${index}.png`, 'image/png'),
  );
  const photoRich = buildTaskTelegramRichContent(
    buildTaskTelegramContent(null, photos, resolveUrl),
  );
  assert.ok(photoRich);
  assert.equal(photoRich.media.length, 50);
  assert.match(photoRich.html, />photo-50\.png<\/a>/);

  const largeVideos = [0, 1].map((index) => ({
    ...attachment(`video-${index}`, `video-${index}.mp4`, 'video/mp4'),
    sizeBytes: 30 * 1024 * 1024,
  }));
  const videoRich = buildTaskTelegramRichContent(
    buildTaskTelegramContent(null, largeVideos, resolveUrl),
  );
  assert.ok(videoRich);
  assert.equal(videoRich.media.length, 1);
  assert.match(videoRich.html, />video-1\.mp4<\/a>/);
});

test('fallback remains a single bounded HTML message and escapes attachment names', () => {
  const unsafe = attachment('doc-1', '</a><script>alert(1)</script>.pdf', 'application/pdf');
  const parts = buildTaskTelegramContent('Описание '.repeat(1_000), [unsafe], resolveUrl);
  const fallback = buildTaskTelegramFallbackContent(parts, 'https://pf.test/projects/p1?task=t1');

  assert.ok(fallback.length <= 3_900);
  assert.doesNotMatch(fallback, /<script>/);
  assert.match(fallback, /&lt;\/a&gt;&lt;script&gt;/);
  assert.match(fallback, /Открыть в ProjectsFlow/);
});
