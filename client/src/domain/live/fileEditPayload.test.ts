import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFileEditPayload, finalDiffForFileEdit } from './fileEditPayload';
import type { LiveFileDiff } from './LiveFileDiff';

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

test('historical empty events find only an unambiguous final comparison from their own run', () => {
  const diff = (path: string): LiveFileDiff => ({ path, change: 'modified', additions: 1, deletions: 1, unifiedDiff: '-before\n+after', isBinary: false, truncated: false });
  const file = diff('client/src/feature.ts');
  assert.equal(finalDiffForFileEdit('C:\\worker\\project\\client\\src\\feature.ts', [file]), file);
  assert.equal(finalDiffForFileEdit('client/src/feature.ts', [file]), file);
  assert.equal(finalDiffForFileEdit('C:\\worker\\project\\feature.ts', [file]), undefined);
  assert.equal(finalDiffForFileEdit('/worker/project/src/Feature.ts', [diff('src/feature.ts')]), undefined);
  assert.equal(finalDiffForFileEdit('C:\\worker\\project\\nested\\client\\src\\feature.ts', [file, diff('nested/client/src/feature.ts')]), undefined);
  assert.equal(finalDiffForFileEdit('C:\\worker\\project\\client\\src\\feature.ts', []), undefined);
});
