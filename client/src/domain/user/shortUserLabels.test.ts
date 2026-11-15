import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortUserLabels } from './shortUserLabels';

test('first name is enough while it is unique', () => {
  const labels = shortUserLabels([
    { id: '1', label: 'Денис Волков' },
    { id: '2', label: 'benzin' },
    { id: '3', label: '  Тест  ' },
  ]);
  assert.deepEqual([...labels.values()], ['Денис', 'benzin', 'Тест']);
});

test('namesakes get the initial of the next word, case-insensitively', () => {
  const labels = shortUserLabels([
    { id: '1', label: 'Олег Боев' },
    { id: '2', label: 'олег Котов' },
    { id: '3', label: 'Олег' },
    { id: '4', label: 'Ярослав Боев' },
  ]);
  assert.equal(labels.get('1'), 'Олег Б.');
  assert.equal(labels.get('2'), 'олег К.');
  assert.equal(labels.get('3'), 'Олег');
  assert.equal(labels.get('4'), 'Ярослав');
});

test('an e-mail label is shortened to its local part', () => {
  const labels = shortUserLabels([{ id: '1', label: 'vera@example.invalid' }]);
  assert.equal(labels.get('1'), 'vera');
});
