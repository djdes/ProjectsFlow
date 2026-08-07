import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPatches,
  settledPatchIds,
  withPatch,
  withoutPatches,
  type PatchMap,
} from './optimisticTaskPatches';

const t = (id: string, status: string) => ({ id, status: status as never });

test('applyPatches: без правок список возвращается как есть', () => {
  const list = [t('a', 'todo')];
  assert.equal(applyPatches(list, new Map()), list);
});

test('applyPatches: hidden выкидывает карточку', () => {
  const patches: PatchMap = new Map([['a', { kind: 'hidden' }]]);
  assert.deepEqual(
    applyPatches([t('a', 'todo'), t('b', 'todo')], patches).map((x) => x.id),
    ['b'],
  );
});

test('applyPatches: status подменяет статус, не трогая остальные поля', () => {
  const patches: PatchMap = new Map([['a', { kind: 'status', status: 'pending_approval' as never }]]);
  const [first] = applyPatches([{ ...t('a', 'todo'), extra: 1 }], patches);
  assert.equal(first?.status, 'pending_approval');
  assert.equal((first as { extra: number }).extra, 1);
});

// Оверрайд, который не снимают, навсегда затеняет реальный статус и прячет чужие правки —
// ровно та ловушка, из-за которой в InboxCheckbox стоит сброс по task.status.
test('settledPatchIds: статус совпал с серверным — правка отработала', () => {
  const patches: PatchMap = new Map([['a', { kind: 'status', status: 'manual' as never }]]);
  assert.deepEqual(settledPatchIds(patches, [t('a', 'manual')]), ['a']);
});

test('settledPatchIds: сервер ещё не догнал — правку держим', () => {
  const patches: PatchMap = new Map([['a', { kind: 'status', status: 'manual' as never }]]);
  assert.deepEqual(settledPatchIds(patches, [t('a', 'todo')]), []);
});

test('settledPatchIds: hidden отработала, когда задачи в живых данных не стало', () => {
  const patches: PatchMap = new Map([['a', { kind: 'hidden' }]]);
  assert.deepEqual(settledPatchIds(patches, []), ['a']);
  assert.deepEqual(settledPatchIds(patches, [t('a', 'todo')]), []);
});

test('settledPatchIds: status-правка на исчезнувшую задачу тоже снимается', () => {
  const patches: PatchMap = new Map([['a', { kind: 'status', status: 'manual' as never }]]);
  assert.deepEqual(settledPatchIds(patches, []), ['a']);
});

test('withPatch / withoutPatches: иммутабельность и no-op при отсутствии ключей', () => {
  const empty: PatchMap = new Map();
  const one = withPatch(empty, 'a', { kind: 'hidden' });
  assert.equal(empty.size, 0);
  assert.equal(one.size, 1);
  assert.equal(withoutPatches(one, []), one);
  assert.equal(withoutPatches(one, ['zzz']), one);
  assert.equal(withoutPatches(one, ['a']).size, 0);
});
