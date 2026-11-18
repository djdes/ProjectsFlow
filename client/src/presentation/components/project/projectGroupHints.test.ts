import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAliasInput } from './projectGroupHints';

test('aliases: split by comma/newline, trimmed, deduplicated', () => {
  assert.deepEqual(parseAliasInput(' конфиг, Конфиг\nпланер ;  '), ['конфиг', 'планер']);
  assert.deepEqual(parseAliasInput(''), []);
});
