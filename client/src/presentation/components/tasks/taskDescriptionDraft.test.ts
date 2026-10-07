import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskDescriptionDraft } from './taskDescriptionDraft';

test('late save preserves typing/marks and serially persists the newer draft', async () => {
  const submitted: string[] = [];
  const replies: Array<(value: string) => void> = [];
  const draft = new TaskDescriptionDraft('Название', value => {
    submitted.push(value);
    return new Promise(resolve => replies.push(resolve));
  }, () => undefined, () => undefined);
  draft.change('**Название**');
  const first = draft.commit();
  draft.change('**Название** и *детали*');
  assert.equal(draft.commit(), first, 'blur/submit share the in-flight queue');
  assert.equal(submitted.length, 1);
  replies[0]('**Название**');
  await Promise.resolve();
  assert.equal(draft.value, '**Название** и *детали*');
  assert.deepEqual(submitted, ['**Название**', '**Название** и *детали*']);
  replies[1]('**Название** и *детали*');
  await first;
  assert.equal(draft.saving, false);
  await draft.commit();
  assert.equal(submitted.length, 2, 'unchanged close does not save twice');
});

test('save failure retains formatted draft and can be retried', async () => {
  let fail = true;
  const draft = new TaskDescriptionDraft('Название', async value => {
    if (fail) throw new Error('503');
    return value;
  }, () => undefined, () => undefined);
  draft.change('**Название**');
  await assert.rejects(draft.commit(), /503/);
  assert.equal(draft.value, '**Название**');
  assert.equal(draft.saving, false);
  fail = false;
  await draft.commit();
  assert.equal(draft.value, '**Название**');
});
