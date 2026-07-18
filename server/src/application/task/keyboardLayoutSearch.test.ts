import test from 'node:test';
import assert from 'node:assert/strict';

import { keyboardLayoutQueryVariants } from './keyboardLayoutSearch.js';

test('строит вариант запроса для неверной русской раскладки', () => {
  assert.deepEqual(keyboardLayoutQueryVariants('вщсы'), ['вщсы', 'docs']);
});

test('строит вариант запроса для неверной английской раскладки', () => {
  assert.deepEqual(keyboardLayoutQueryVariants('ghjtrn'), ['ghjtrn', 'проект']);
});
