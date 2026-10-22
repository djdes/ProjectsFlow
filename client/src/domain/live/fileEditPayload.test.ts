import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFileEditPayload } from './fileEditPayload';

test('empty, unchanged and malformed edits never become empty diffs', () => {
  assert.deepEqual(parseFileEditPayload({
    path: 'file.ts', edits: [{ old: '', new: '' }, { old: 'same', new: 'same' }, {}, null, { old: 1, new: 2 }],
  }), { path: 'file.ts', edits: [] });
  for (const payload of [null, [], 'text', {}, { path: 3 }]) {
    assert.equal(parseFileEditPayload(payload), null);
  }
  assert.deepEqual(parseFileEditPayload({ path: 'file.ts', edits: null }), { path: 'file.ts', edits: [] });
});

test('insertions, deletions and whitespace changes retain their exact content', () => {
  const edits = [{ old: '', new: 'добавлено' }, { old: 'removed', new: '' }, { old: ' ', new: '\t' }];
  assert.deepEqual(parseFileEditPayload({ path: 'file.ts', edits }), { path: 'file.ts', edits });
});

test('native Edit and MultiEdit payloads retain before and after text', () => {
  const edit = { old_string: 'Было: пустые изменения', new_string: 'Стало: виден текст изменения' };
  const expected = { path: 'file.ts', edits: [{ old: 'Было: пустые изменения', new: 'Стало: виден текст изменения' }] };
  assert.deepEqual(parseFileEditPayload({ file_path: 'file.ts', ...edit }), expected);
  assert.deepEqual(parseFileEditPayload({ path: 'file.ts', edits: [edit] }), expected);
});

test('invalid fragments do not discard valid changes in the same event', () => {
  assert.deepEqual(parseFileEditPayload({
    path: 'file.ts',
    edits: [null, { old: '', new: '' }, { old: 'a', new: 'b' }, { old: 'missing after' }],
  }), { path: 'file.ts', edits: [{ old: 'a', new: 'b' }] });
});
