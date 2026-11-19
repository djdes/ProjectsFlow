import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneticKey, matchProjectAlias, normalizeAliases, pickProjectByHints } from './projectHints.js';

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

test('hints: Russian transliteration resolves Latin project names', () => {
  const latin = [
    { id: 'y', name: 'Yesbeat' },
    { id: 'c', name: 'C# Config' },
    { id: 'f', name: 'FilterMusic' },
  ];
  assert.equal(pickProjectByHints('есбит тест таск', latin)?.id, 'y');
  assert.equal(pickProjectByHints('йесбит: упал отчёт', latin)?.id, 'y');
  assert.equal(pickProjectByHints('в есбите не грузится', latin)?.id, 'y');
  assert.equal(pickProjectByHints('конфиг не сохраняет', latin)?.id, 'c');
  assert.equal(pickProjectByHints('фильтрмьюзик не играет', latin)?.id, 'f');
  assert.equal(pickProjectByHints('фильтр мьюзик не играет', latin)?.id, 'f');
  assert.equal(pickProjectByHints('купить молоко и хлеб', latin), null);
  assert.equal(pickProjectByHints('есбит и конфиг', latin), null);
  assert.equal(phoneticKey('йесбит'), phoneticKey('Yesbeat'));
});

test('hints: transliteration also matches aliases', () => {
  assert.equal(pickProjectByHints('в кассе ошибка', [{ id: 'a', name: 'Альфа', aliases: ['Kassa'] }, { id: 'b', name: 'Бета' }])?.id, 'a');
});

test('hints: phonetic keys', () => {
  assert.equal(phoneticKey('Yesbeat'), 'esbit');
  assert.equal(phoneticKey('конфиг'), 'konfig');
  assert.equal(phoneticKey('C# Config'), 'konfig');
  assert.equal(phoneticKey('FilterMusic'), 'filtermusik');
});

test('hints: doubled letters collapse', () => {
  assert.equal(phoneticKey('Kassa'), 'kasa');
  assert.equal(phoneticKey('касса'), 'kasa');
});
