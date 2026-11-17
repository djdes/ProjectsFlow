import test from 'node:test';
import assert from 'node:assert/strict';

import { composeSharedTaskText } from './sharedTaskText';

test('a shared page: its title becomes the task title, the link goes to the body', () => {
  assert.equal(
    composeSharedTaskText({ title: 'Новый дизайн оплаты', text: '', url: 'https://example.com/pay' }),
    'Новый дизайн оплаты\nhttps://example.com/pay',
  );
});

test('shared text without a title: its first line is the title, the rest is the body', () => {
  assert.equal(
    composeSharedTaskText({ text: 'Позвонить клиенту\nОн ждёт счёт до пятницы' }),
    'Позвонить клиенту\nОн ждёт счёт до пятницы',
  );
});

test('a link already inside the text is not repeated; a bare link becomes the title', () => {
  assert.equal(
    composeSharedTaskText({ text: 'Глянь https://example.com/a', url: 'https://example.com/a' }),
    'Глянь https://example.com/a',
  );
  assert.equal(composeSharedTaskText({ url: 'https://example.com/b' }), 'https://example.com/b');
  assert.equal(composeSharedTaskText({}), '');
});
