import assert from 'node:assert/strict';
import test from 'node:test';
import { joinPreviewUrl, normalizePreviewPath } from './path';

test('normalizes only paths inside the preview origin', () => {
  assert.equal(normalizePreviewPath('catalog?q=1'), '/catalog?q=1');
  assert.equal(normalizePreviewPath('/'), '/');
  assert.equal(normalizePreviewPath('//evil.example'), null);
  assert.equal(normalizePreviewPath('/foo\\bar'), null);
  assert.equal(normalizePreviewPath('/foo\u0000bar'), null);
});

test('joins a route without inheriting a foreign origin', () => {
  assert.equal(joinPreviewUrl('https://demo.projectsflow.ru/base', '/catalog'), 'https://demo.projectsflow.ru/catalog');
});
