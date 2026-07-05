import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signAttachmentUrl,
  verifyAttachmentToken,
  attachmentIdFromSrc,
} from './signedAttachmentUrl.js';
import { figureImageSrc, extractImageSrcs, stripFigureLines, markdownToRich } from '../../domain/task/digestFormat.js';

const SECRET = 'test-secret';
const NOW = 1_700_000_000_000;

test('signed URL round-trips: verify true для свежей подписи', () => {
  const url = signAttachmentUrl('https://x.ru', '/api/attachments/abc123', SECRET, 3600, NOW);
  assert.ok(url);
  const u = new URL(url!);
  assert.equal(u.pathname, '/api/attachments/abc123');
  const e = u.searchParams.get('e')!;
  const s = u.searchParams.get('s')!;
  assert.equal(verifyAttachmentToken('abc123', e, s, SECRET, NOW), true);
});

test('verify false: истёкший срок', () => {
  const url = signAttachmentUrl('https://x.ru', '/api/attachments/abc', SECRET, 10, NOW)!;
  const u = new URL(url);
  const e = u.searchParams.get('e')!;
  const s = u.searchParams.get('s')!;
  // now через 20с после exp (exp = NOW/1000 + 10)
  assert.equal(verifyAttachmentToken('abc', e, s, SECRET, NOW + 20_000), false);
});

test('verify false: чужой секрет / подделанная подпись', () => {
  const url = signAttachmentUrl('https://x.ru', '/api/attachments/abc', SECRET, 3600, NOW)!;
  const u = new URL(url);
  const e = u.searchParams.get('e')!;
  const s = u.searchParams.get('s')!;
  assert.equal(verifyAttachmentToken('abc', e, s, 'other-secret', NOW), false);
  assert.equal(verifyAttachmentToken('abc', e, 'deadbeef', SECRET, NOW), false);
  // подмена id — подпись уже не сходится
  assert.equal(verifyAttachmentToken('xyz', e, s, SECRET, NOW), false);
});

test('attachmentIdFromSrc: только наши URL', () => {
  assert.equal(attachmentIdFromSrc('/api/attachments/e5150d4f-23a8'), 'e5150d4f-23a8');
  assert.equal(signAttachmentUrl('https://x.ru', 'https://evil.com/x.png', SECRET, 60, NOW), null);
});

test('figureImageSrc парсит строку-картинку редактора', () => {
  assert.equal(
    figureImageSrc('<figure data-figure-image><img src="/api/attachments/abc" alt="" /></figure>'),
    '/api/attachments/abc',
  );
  assert.equal(figureImageSrc('  <figure data-figure-image><img alt="x" src="/api/attachments/z"></figure>  '), '/api/attachments/z');
  assert.equal(figureImageSrc('обычный текст'), null);
});

test('markdownToRich email → <img>, telegram → срезает картинку', () => {
  const md = 'до\n\n<figure data-figure-image><img src="/api/attachments/abc" alt="" /></figure>\n\nпосле';
  const email = markdownToRich(md, 'email', { resolveImageUrl: () => 'https://x.ru/signed' });
  assert.match(email, /<img src="https:\/\/x\.ru\/signed"/);
  assert.doesNotMatch(email, /figure|data-figure-image/);
  const tg = markdownToRich(md, 'telegram');
  assert.doesNotMatch(tg, /figure|img|api\/attachments/);
  assert.match(tg, /до/);
  assert.match(tg, /после/);
});

test('extractImageSrcs / stripFigureLines', () => {
  const md = 'a\n<figure data-figure-image><img src="/api/attachments/1"></figure>\nb\n<figure data-figure-image><img src="/api/attachments/2"></figure>';
  assert.deepEqual(extractImageSrcs(md), ['/api/attachments/1', '/api/attachments/2']);
  assert.equal(stripFigureLines(md), 'a\nb');
});
