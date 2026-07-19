import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_COMPOSER_MAX_LENGTH,
  clampComposerText,
  fitInsertion,
  isComposerBlank,
  normalizePastedText,
  plainTextFromEditable,
} from './composerText';

function editable(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

test('читает переносы строк из <br>, как их пишет contenteditable', () => {
  assert.equal(plainTextFromEditable(editable('первая<br>вторая')), 'первая\nвторая');
});

test('читает переносы строк из блоков, как их пишет браузер после Enter', () => {
  assert.equal(plainTextFromEditable(editable('<div>первая</div><div>вторая</div>')), 'первая\nвторая');
});

test('сохраняет пустую строку в конце, но не добавляет лишнюю от закрытия блока', () => {
  assert.equal(plainTextFromEditable(editable('<div>строка</div>')), 'строка');
  assert.equal(plainTextFromEditable(editable('<div>строка</div><div><br></div>')), 'строка\n');
});

test('отбрасывает разметку вставленного HTML и оставляет только текст', () => {
  const pasted = '<p><b>жирный</b> и <a href="https://example.com">ссылка</a></p>';
  assert.equal(plainTextFromEditable(editable(pasted)), 'жирный и ссылка');
});

test('пустое поле с одиночным <br> считается пустым', () => {
  assert.equal(isComposerBlank(plainTextFromEditable(editable('<br>'))), true);
});

test('неразрывный пробел не делает поле непустым', () => {
  assert.equal(isComposerBlank(plainTextFromEditable(editable('&nbsp;'))), true);
});

test('нормализует CRLF и вычищает управляющие символы, не трогая переносы', () => {
  assert.equal(normalizePastedText('строка\r\nдругая'), 'строка\nдругая');
});

test('вставка обрезается по остатку лимита', () => {
  const current = 'a'.repeat(AI_COMPOSER_MAX_LENGTH - 5);
  assert.equal(fitInsertion(current, 'bbbbbbbbbb'), 'bbbbb');
  assert.equal(fitInsertion('a'.repeat(AI_COMPOSER_MAX_LENGTH), 'b'), '');
  assert.equal(clampComposerText('abcdef', 3), 'abc');
});
