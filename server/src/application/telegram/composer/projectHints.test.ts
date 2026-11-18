import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProjectAlias, normalizeAliases, pickProjectByHints } from './projectHints.js';

const projects = [
  { id: 'a', name: 'Планер', aliases: ['календарь'] },
  { id: 'b', name: 'Конфигуратор', aliases: ['конфиг'] },
  { id: 'c', name: 'Сайт' },
];

test('hints: exact name or alias as a word wins over stems', () => {
  assert.equal(pickProjectByHints('в конфиг добавить поле', projects)?.id, 'b');
  assert.equal(pickProjectByHints('Сайт лежит', projects)?.id, 'c');
  assert.equal(pickProjectByHints('в календаре пропали события', projects)?.id, 'a');
  assert.equal(pickProjectByHints('конфигуратор, а не планер', projects), null);
  assert.equal(pickProjectByHints('ничего не понятно', projects), null);
});

test('hints: alias query is exact and unique', () => {
  assert.equal(matchProjectAlias('Конфиг', projects)?.id, 'b');
  assert.equal(matchProjectAlias('конф', projects), null);
});

test('hints: aliases are trimmed, deduplicated and capped', () => {
  assert.deepEqual(normalizeAliases([' конфиг ', 'Конфиг', '', 'планер']), ['конфиг', 'планер']);
  assert.equal(normalizeAliases(Array.from({ length: 30 }, (_, i) => `a${i}`)).length, 20);
});
