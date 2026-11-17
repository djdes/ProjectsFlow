import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';

import { buildExtensions } from './buildExtensions';
import { TASK_TITLE_LINE_CLASS, TaskTitleLine, titleLineRange } from './taskTitleLine';

function open(md: string): Editor {
  return new Editor({ extensions: [...buildExtensions(), TaskTitleLine], content: md, contentType: 'markdown' });
}

const titleText = (editor: Editor): string | null => {
  const range = titleLineRange(editor.state.doc);
  return range ? editor.state.doc.textBetween(range.from, range.to) : null;
};

test('a title and its body in one paragraph: only the first line is the title', () => {
  const editor = open('Обновить главную страницу\nНовый первый экран и блок акций.');
  try {
    assert.equal(titleText(editor), 'Обновить главную страницу');
    const marked = editor.view.dom.querySelector(`.${TASK_TITLE_LINE_CLASS}`);
    assert.equal(marked?.textContent, 'Обновить главную страницу');
  } finally {
    editor.destroy();
  }
});

test('a title in its own paragraph is decorated whole, the body paragraph is not', () => {
  const editor = open('Сверстать страницу врачей\n\nКарточки врачей с фильтром.');
  try {
    assert.equal(titleText(editor), 'Сверстать страницу врачей');
    assert.equal(editor.view.dom.querySelectorAll(`.${TASK_TITLE_LINE_CLASS}`).length, 1);
  } finally {
    editor.destroy();
  }
});

test('decorating never changes the stored markdown', () => {
  const md = 'Название\nТекст задачи';
  const editor = open(md);
  try {
    const before = editor.getMarkdown();
    editor.view.dispatch(editor.state.tr);
    assert.equal(editor.getMarkdown(), before);
  } finally {
    editor.destroy();
  }
});

test('no title line for an empty text or a heading', () => {
  for (const md of ['', '# Заголовок\n\nТекст']) {
    const editor = open(md);
    try {
      assert.equal(titleLineRange(editor.state.doc), null);
    } finally {
      editor.destroy();
    }
  }
});
