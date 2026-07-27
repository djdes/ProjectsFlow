import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDonePrefix } from './parseDonePrefix.js';

test('распознаёт «готово» и «сделано» в начале, срезает слово и разделитель', () => {
  assert.deepEqual(parseDonePrefix('готово починить сборку'), { isDone: true, rest: 'починить сборку' });
  assert.deepEqual(parseDonePrefix('Сделано обнови билд'), { isDone: true, rest: 'обнови билд' });
  assert.deepEqual(parseDonePrefix('Готово: выкатил релиз'), { isDone: true, rest: 'выкатил релиз' });
  assert.deepEqual(parseDonePrefix('готово — почистил логи'), { isDone: true, rest: 'почистил логи' });
  assert.deepEqual(parseDonePrefix('  ГОТОВО  прод обновлён'), { isDone: true, rest: 'прод обновлён' });
});

test('не срабатывает, когда слово — часть другого слова или не в начале', () => {
  assert.equal(parseDonePrefix('готовность к релизу').isDone, false);
  assert.equal(parseDonePrefix('сделанный отчёт').isDone, false);
  assert.equal(parseDonePrefix('надо готово выкатить').isDone, false);
  assert.equal(parseDonePrefix('обнови билд').isDone, false);
});

test('«готово» без текста задачи → isDone, но rest пустой', () => {
  assert.deepEqual(parseDonePrefix('готово'), { isDone: true, rest: '' });
  assert.deepEqual(parseDonePrefix('Сделано.'), { isDone: true, rest: '' });
});
