import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationExcerpt } from './notificationExcerpt.js';

test('renders Markdown and extracts rich editor images beyond the excerpt', () => {
  const result = notificationExcerpt('**Заголовок**\n\n' + 'текст '.repeat(100)
    + '<figure data-figure-image><img src="/api/attachments/photo" /></figure>', 'https://pf.test');
  assert.match(result, /<b>Заголовок<\/b>/u);
  assert.match(result, /href="https:\/\/pf.test\/api\/attachments\/photo"/u);
  assert.doesNotMatch(result, /figure|&lt;img|\*\*/u);
});

test('supports Markdown images, deduplicates and escapes image URLs', () => {
  const result = notificationExcerpt('![скрин](https://img.test/a?q="x")\n'
    + '<img src="/api/attachments/a?x=1&amp;y=2"><img src="/api/attachments/a?x=1&amp;y=2">',
  'https://pf.test');
  assert.match(result, /q=%22x%22/u);
  assert.match(result, /x=1&amp;y=2/u);
  assert.equal((result.match(/<a /gu) ?? []).length, 2);
});

test('ignores unsafe image URLs and internal comment markers', () => {
  assert.equal(notificationExcerpt('<!-- ralph-question secret -->Привет<img src="javascript:alert(1)">',
    'https://pf.test'), 'Привет');
});
