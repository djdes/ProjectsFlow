import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGroupHintsDirty, parseAliasInput } from './projectGroupHints';

test('aliases: split by comma/newline, trimmed, deduplicated', () => {
  assert.deepEqual(parseAliasInput(' конфиг, Конфиг\nпланер ;  '), ['конфиг', 'планер']);
  assert.deepEqual(parseAliasInput(''), []);
});

test('group hints: флаг «Полный прогон по умолчанию» тоже делает карточку изменённой', () => {
  const saved = { aliases: ['конфиг'], shortDescription: null, groupFullRunDefault: false };
  assert.equal(isGroupHintsDirty(saved, { aliases: ['конфиг'], description: '  ', fullRun: false }), false);
  assert.equal(isGroupHintsDirty(saved, { aliases: ['конфиг'], description: '', fullRun: true }), true);
  assert.equal(isGroupHintsDirty({ ...saved, groupFullRunDefault: true }, { aliases: ['конфиг'], description: '', fullRun: true }), false);
});
