import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prodStatusLine } from './ReportTelegramWorkerResult.js';

test('prodStatusLine: прод обновлён → «Уже в проде»', () => {
  assert.equal(prodStatusLine(['Готово. PR #3 смержен в main, прод обновлён, сборка ОК.']), '🚀 Уже в проде.');
});

test('prodStatusLine: деплой упал → предупреждение, даже если есть «прод обновлён»', () => {
  assert.match(prodStatusLine([
    'Готово. прод обновлён',
    '⚠️🚀 ДЕПЛОЙ НЕ ПРОШЁЛ: команда упала. Код в main, но ПРОД НЕ ОБНОВЛЁН.',
  ]) ?? '', /не выкачено/);
});

test('prodStatusLine: о деплое ничего — ничего не пишем', () => {
  assert.equal(prodStatusLine(['Готово, проверки ОК.']), null);
});
