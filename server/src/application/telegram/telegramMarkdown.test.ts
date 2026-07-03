import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToTelegramHtml } from './telegramMarkdown.js';

describe('markdownToTelegramHtml', () => {
  it('жирный **x** → <b>', () => {
    assert.equal(markdownToTelegramHtml('это **важно** очень'), 'это <b>важно</b> очень');
  });

  it('жирный __x__ → <b>', () => {
    assert.equal(markdownToTelegramHtml('__bold__'), '<b>bold</b>');
  });

  it('курсив *x* → <i>', () => {
    assert.equal(markdownToTelegramHtml('текст *курсив* тут'), 'текст <i>курсив</i> тут');
  });

  it('зачёркнутый ~~x~~ → <s>', () => {
    assert.equal(markdownToTelegramHtml('~~нет~~'), '<s>нет</s>');
  });

  it('инлайн-код `x` → <code> (с экранированием)', () => {
    assert.equal(markdownToTelegramHtml('код `a < b`'), 'код <code>a &lt; b</code>');
  });

  it('ссылка [t](u) → <a>', () => {
    assert.equal(
      markdownToTelegramHtml('[тут](https://x.ru/a?b=1&c=2)'),
      '<a href="https://x.ru/a?b=1&amp;c=2">тут</a>',
    );
  });

  it('заголовок # — срезаем маркер', () => {
    assert.equal(markdownToTelegramHtml('# Заголовок'), 'Заголовок');
    assert.equal(markdownToTelegramHtml('### H3'), 'H3');
  });

  it('список - / * → буллет', () => {
    assert.equal(markdownToTelegramHtml('- пункт'), '• пункт');
    assert.equal(markdownToTelegramHtml('* пункт'), '• пункт');
  });

  it('горизонтальная линия --- убирается', () => {
    assert.equal(markdownToTelegramHtml('---'), '');
    assert.equal(markdownToTelegramHtml('a\n---\nb'), 'a\nb');
  });

  it('HTML-спецсимволы экранируются', () => {
    assert.equal(markdownToTelegramHtml('<script>&"'), '&lt;script&gt;&amp;"');
  });

  it('snake_case НЕ превращается в курсив', () => {
    assert.equal(markdownToTelegramHtml('поле task_id_value тут'), 'поле task_id_value тут');
  });

  it('осевшие непарные ** (после обрезки) убираются', () => {
    assert.equal(markdownToTelegramHtml('начало **жирный те'), 'начало жирный те');
  });

  it('пустая строка → пусто', () => {
    assert.equal(markdownToTelegramHtml(''), '');
  });
});
