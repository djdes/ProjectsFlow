import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskTitleText } from './TaskTitleText';
import { Markdown } from '../markdown/Markdown';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const render = (title: string) => renderToStaticMarkup(React.createElement(TaskTitleText, { title, inline: true }));

test('title keeps inline formatting from creation and editing', () => {
  const html = render('## Обычный **жирный** *курсив* ~~готово~~ ++линия++ `код` ==важно==');
  assert.match(html, /Обычный <strong>жирный<\/strong> <em>курсив<\/em> <del>готово<\/del> <u>линия<\/u> <code>код<\/code> <mark>важно<\/mark>/);
  assert.doesNotMatch(html, /<h2|##/);
});

test('rule/list-like task titles remain visible literal text', () => {
  for (const title of ['---', '- **Проверить** товар', '* список', '1. пункт', '> заметка']) {
    const html = render(title);
    assert.doesNotMatch(html, /<(hr|ul|ol|li|blockquote|h[1-6])\b/);
    assert.ok(html.includes(title.replace('>', '&gt;').replace('**Проверить**', '<strong>Проверить</strong>')), `${title}: ${html}`);
  }
});

test('titles retain safe colors but cannot inject HTML actions or nested links', () => {
  const html = render('<span style="color:#2383e2">Цвет</span> [ссылка](javascript:alert) <img src=x onerror=alert(1)> <script>alert(2)</script>');
  assert.match(html, /style="color:#2383e2"/);
  assert.doesNotMatch(html, /<a\b|<img\b|<script\b|onerror|javascript:|alert\(2\)/);
  assert.match(html, /ссылка/);
});

test('combined color/bold/underline survives editor serialization order', () => {
  for (const value of ['**<span style="color:#337ea9">++важно++</span>**', '<span style="color:#337ea9">**++важно++**</span>']) {
    const html = render(value);
    assert.match(html, /<strong>/);
    assert.match(html, /<u>важно<\/u>/);
    assert.match(html, /color:#337ea9/);
    assert.doesNotMatch(html, /\+\+|\*\*/);
  }
});

test('description previews preserve combined color/bold/underline', () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, {
    children: '<span style="color:#337ea9">**++важно++**</span>\n\nОбычный текст',
  }));
  assert.match(html, /<strong><u>важно<\/u><\/strong>/);
  assert.match(html, /color:#337ea9/);
  assert.doesNotMatch(html, /\+\+|\*\*/);
});
