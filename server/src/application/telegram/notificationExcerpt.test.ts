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

test('removes dispatcher badge wrappers before clipping the excerpt', () => {
  const result = notificationExcerpt(
    '<span style="background:#1f883d;color:#fff;padding:2px 8px;border-radius:4px">🛡 На утверждении</span>'
    + '\n\n**Готово** — проверьте результат.'
    + '<figure data-figure-image><img src="/api/attachments/photo"></figure>',
    'https://pf.test', 60);
  assert.match(result, /^🛡 На утверждении\n\n<b>Готово<\/b> — проверьте результат\./u);
  assert.match(result, /href="https:\/\/pf.test\/api\/attachments\/photo"/u);
  assert.doesNotMatch(result, /span|style|background|figure|&lt;/u);
});

test('keeps literal HTML in code examples while removing surrounding HTML', () => {
  const result = notificationExcerpt(
    '<div>Пример: `<span>текст</span>`</div>\n```html\n<p>абзац</p>\n```',
    'https://pf.test');
  assert.equal(result, 'Пример: <code>&lt;span&gt;текст&lt;/span&gt;</code>\n'
    + '<pre>&lt;p&gt;абзац&lt;/p&gt;</pre>');
});
