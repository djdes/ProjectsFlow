import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTypeFilter } from './taskTypeMeta';

test('режим «всё» пропускает любую задачу', () => {
  assert.equal(matchesTypeFilter('bug', 'all'), true);
  assert.equal(matchesTypeFilter('feature', 'all'), true);
  assert.equal(matchesTypeFilter(null, 'all'), true);
  assert.equal(matchesTypeFilter(undefined, 'all'), true);
});

test('режим «только баги» пропускает лишь явные баги', () => {
  assert.equal(matchesTypeFilter('bug', 'bug'), true);
  assert.equal(matchesTypeFilter('feature', 'bug'), false);
  assert.equal(matchesTypeFilter(null, 'bug'), false);
  assert.equal(matchesTypeFilter(undefined, 'bug'), false);
});

test('режим «только фичи» пропускает и задачи без типа', () => {
  // Поле появилось недавно: если бы null отсекался, режим прятал бы почти всю доску.
  assert.equal(matchesTypeFilter('feature', 'feature'), true);
  assert.equal(matchesTypeFilter(null, 'feature'), true);
  assert.equal(matchesTypeFilter(undefined, 'feature'), true);
  assert.equal(matchesTypeFilter('bug', 'feature'), false);
});
