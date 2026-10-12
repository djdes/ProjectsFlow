import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesInboxQuery } from './searchTasks';

const task = { projectName: 'Wesetup', description: 'Проверить отчёт\nОбновить **текст** лендинга и [контакты](https://example.test).' };

test('inbox search matches a project, title or formatted task body', () => {
  for (const query of ['WESETUP', 'проверить отчет', 'текст лендинга', 'и контакты', '  текст   лендинга  ', '']) {
    assert.equal(matchesInboxQuery(task, query), true, query);
  }
  assert.equal(matchesInboxQuery(task, 'нет такого текста'), false);
  assert.equal(matchesInboxQuery({ projectName: 'OrdersFlow', description: null }, 'orders'), true);
});
