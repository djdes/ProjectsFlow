import test from 'node:test';
import assert from 'node:assert/strict';

import {
  keyboardLayoutQueryVariants,
  matchesKeyboardLayoutQuery,
  matchingKeyboardLayoutQuery,
} from './keyboardLayoutSearch';

test('распознаёт английское слово, набранное в русской раскладке', () => {
  assert.deepEqual(keyboardLayoutQueryVariants('вщсы'), ['вщсы', 'docs']);
  assert.equal(matchesKeyboardLayoutQuery('DocsFlow', 'вщсы'), true);
  assert.equal(matchingKeyboardLayoutQuery('DocsFlow', 'вщсы'), 'docs');
});

test('распознаёт русское слово, набранное в английской раскладке', () => {
  assert.deepEqual(keyboardLayoutQueryVariants('ghjtrn'), ['ghjtrn', 'проект']);
  assert.equal(matchesKeyboardLayoutQuery('Новый проект', 'ghjtrn'), true);
});

test('сохраняет исходный запрос приоритетным и не создаёт дубли', () => {
  assert.deepEqual(keyboardLayoutQueryVariants('Docs'), ['Docs', 'Вщсы']);
  assert.deepEqual(keyboardLayoutQueryVariants('123'), ['123']);
  assert.deepEqual(keyboardLayoutQueryVariants('  '), []);
});
