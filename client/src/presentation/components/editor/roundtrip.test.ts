// Round-trip тесты markdown ↔ Tiptap-doc: гарантия, что хранение остаётся markdown и
// форматы совпадают с read-вью (Markdown.tsx). Запуск: `npm run test`.
// Tiptap (ProseMirror) требует DOM — поднимаем happy-dom до создания редактора.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';

import { buildExtensions } from './extensions/buildExtensions';

function roundtrip(md: string): string {
  const editor = new Editor({
    extensions: buildExtensions(),
    content: md,
    contentType: 'markdown',
  });
  const out = editor.getMarkdown().trim();
  editor.destroy();
  return out;
}

const CASES: Array<[name: string, md: string]> = [
  ['bold', '**жирный**'],
  ['italic', '*курсив*'],
  ['strike', '~~зачёркнуто~~'],
  ['inline code', '`код`'],
  ['highlight ==', '==выделено=='],
  // Цвет текста/фона хранится как inline-HTML (TextStyle.renderMarkdown → SANITIZE_SCHEMA).
  ['text color', '<span style="color:#d44c47">красный</span>'],
  ['bg color', '<span style="background-color:#faebdd">фон</span>'],
  ['text color inline', 'до <span style="color:#337ea9">синий</span> после'],
  ['heading', '# Заголовок'],
  ['bullet list', '- один\n- два'],
  ['ordered list', '1. один\n2. два'],
  ['task list', '- [ ] открыта\n- [x] закрыта'],
  ['quote', '> цитата'],
  ['link', '[Notion](https://notion.so)'],
  [
    'figure image',
    '<figure data-figure-image><img src="/api/attachments/image-1" alt="" /></figure>',
  ],
];

for (const [name, md] of CASES) {
  test(`round-trip: ${name}`, () => {
    const out = roundtrip(md);
    assert.equal(out, md, `markdown изменился: «${md}» → «${out}»`);
  });
}

test('mention сериализуется в @displayName (серверный parseMentions)', () => {
  const editor = new Editor({
    extensions: buildExtensions({ members: [{ userId: 'u1', displayName: 'Ирина' }] }),
    content: '',
    contentType: 'markdown',
  });
  editor.commands.insertContent({ type: 'mention', attrs: { id: 'u1', label: 'Ирина' } });
  const out = editor.getMarkdown();
  editor.destroy();
  assert.ok(out.includes('@Ирина'), `ожидали @Ирина, получили: «${out}»`);
});
