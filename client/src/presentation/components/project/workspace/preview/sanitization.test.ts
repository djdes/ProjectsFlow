import assert from 'node:assert/strict';
import test from 'node:test';
import { capSnapshot, sanitizeAttribute, sanitizePrompt, sanitizeStylePatch } from './sanitization';

test('allows known CSS and blocks executable or unknown values', () => {
  assert.deepEqual(sanitizeStylePatch('borderRadius', '12px'), { property: 'borderRadius', value: '12px' });
  assert.equal(sanitizeStylePatch('backgroundImage', 'url(https://example.com)'), null);
  assert.equal(sanitizeStylePatch('color', 'expression(alert(1))'), null);
});

test('blocks executable links and caps AI payloads', () => {
  assert.equal(sanitizeAttribute('href', 'javascript:alert(1)'), null);
  assert.deepEqual(sanitizeAttribute('href', '/catalog'), { name: 'href', value: '/catalog' });
  assert.equal(sanitizePrompt('  make\n it blue  '), 'make it blue');
  const capped = capSnapshot({ locator: { selector: 'x'.repeat(900), tagName: 'DIV', text: 'y'.repeat(2_000) }, source: 'z'.repeat(12_000), styles: { color: '#fff', position: 'fixed' } });
  assert.equal(capped.locator.selector.length, 500);
  assert.equal(capped.locator.text?.length, 1_000);
  assert.equal(capped.source?.length, 8_000);
  assert.deepEqual(capped.styles, { color: '#fff' });
});
