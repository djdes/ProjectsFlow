import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoByAnswer } from './answerMemo';

test('the same body gives the same objects; a new body or an unknown one builds again', () => {
  let builds = 0;
  const listOf = memoByAnswer((dto: { items: number[] }) => {
    builds += 1;
    return dto.items.map((n) => ({ n }));
  });
  const first = listOf({ data: { items: [1] }, text: '{"items":[1]}' });
  assert.equal(listOf({ data: { items: [1] }, text: '{"items":[1]}' }), first, 'unchanged answer: React can skip the re-render');
  assert.equal(builds, 1);
  const second = listOf({ data: { items: [2] }, text: '{"items":[2]}' });
  assert.notEqual(second, first);
  assert.deepEqual(second, [{ n: 2 }]);
  listOf({ data: { items: [2] }, text: null });
  listOf({ data: { items: [2] }, text: null });
  assert.equal(builds, 4, 'without a body to compare, every answer is built');
});
