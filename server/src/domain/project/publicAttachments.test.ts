import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteAttachmentUrls } from './publicAttachments.js';

test('rewriteAttachmentUrls: одиночная ссылка → публичный роут', () => {
  const body = '<img src="/api/attachments/abc123de-0000-1111-2222-333344445555">';
  const out = rewriteAttachmentUrls(body, 'cookie-opinion-k3f9q2');
  assert.equal(
    out,
    '<img src="/api/public/boards/cookie-opinion-k3f9q2/attachments/abc123de-0000-1111-2222-333344445555">',
  );
});

test('rewriteAttachmentUrls: несколько ссылок переписываются все', () => {
  const body = 'a /api/attachments/aaaa b /api/attachments/bbbb c';
  const out = rewriteAttachmentUrls(body, 'slug1');
  assert.ok(out.includes('/api/public/boards/slug1/attachments/aaaa'));
  assert.ok(out.includes('/api/public/boards/slug1/attachments/bbbb'));
  assert.ok(!out.includes('/api/attachments/'));
});

test('rewriteAttachmentUrls: чужие URL не трогаются', () => {
  const body = 'see https://example.com/api/attachments-guide and /apiattachments/x';
  const out = rewriteAttachmentUrls(body, 'slug1');
  // /api/attachments-guide не матчится (после id идёт `-guide`, но `attachments/` не совпадает).
  assert.equal(out, body);
});

test('rewriteAttachmentUrls: пустое тело', () => {
  assert.equal(rewriteAttachmentUrls('', 'slug1'), '');
});
