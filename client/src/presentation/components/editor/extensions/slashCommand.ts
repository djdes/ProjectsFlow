import { createElement, type ReactElement } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import {
  Text,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
} from 'lucide-react';

import { createSuggestionRender } from '../suggestionRender';
import type { SuggestionItem } from '../SuggestionList';

type SlashItem = SuggestionItem & { run: (editor: Editor, range: Range) => void };

const ICON = 'size-4';
const ce = createElement;

// Превью-рендеры для карточки справа (Notion-style): как выглядит блок этого типа.
const previewText = ce('div', { className: 'text-sm text-neutral-200' }, 'Просто начните писать текст.');
const previewHeading = (size: string, label: string): ReactElement =>
  ce('div', { className: `${size} font-bold leading-tight text-white` }, label);
const previewBullet = ce(
  'div',
  { className: 'space-y-1 text-sm text-neutral-200' },
  ce('div', { key: 'a' }, '•  Первый пункт'),
  ce('div', { key: 'b' }, '•  Второй пункт'),
);
const previewOrdered = ce(
  'div',
  { className: 'space-y-1 text-sm text-neutral-200' },
  ce('div', { key: 'a' }, '1.  Первый пункт'),
  ce('div', { key: 'b' }, '2.  Второй пункт'),
);
const previewTodo = ce(
  'div',
  { className: 'space-y-1.5 text-sm text-neutral-200' },
  ce(
    'div',
    { key: 'a', className: 'flex items-center gap-2' },
    ce('span', { className: 'inline-block size-3.5 shrink-0 rounded-[3px] border border-neutral-500' }),
    'Сделать',
  ),
  ce(
    'div',
    { key: 'b', className: 'flex items-center gap-2 text-neutral-400 line-through' },
    ce('span', { className: 'inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-blue-500 text-[10px] text-white' }, '✓'),
    'Готово',
  ),
);
const previewQuote = ce(
  'div',
  { className: 'border-l-2 border-neutral-400 pl-2.5 text-sm italic text-neutral-300' },
  'Выделенная цитата.',
);
const previewCode = ce(
  'div',
  { className: 'rounded-md bg-neutral-950 px-2.5 py-1.5 font-mono text-xs text-neutral-200' },
  'const x = 1;',
);
const previewDivider = ce(
  'div',
  { className: 'flex h-full items-center py-2' },
  ce('div', { className: 'h-px w-full bg-neutral-500' }),
);

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'text',
    label: 'Текст',
    icon: createElement(Text, { className: ICON }),
    preview: previewText,
    description: 'Обычный текст абзаца.',
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    id: 'h1',
    label: 'Заголовок 1',
    hint: '#',
    icon: createElement(Heading1, { className: ICON }),
    preview: previewHeading('text-lg', 'Заголовок 1'),
    description: 'Большой заголовок раздела.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Заголовок 2',
    hint: '##',
    icon: createElement(Heading2, { className: ICON }),
    preview: previewHeading('text-base', 'Заголовок 2'),
    description: 'Средний заголовок подраздела.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Заголовок 3',
    hint: '###',
    icon: createElement(Heading3, { className: ICON }),
    preview: previewHeading('text-sm', 'Заголовок 3'),
    description: 'Небольшой заголовок.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Маркированный список',
    icon: createElement(List, { className: ICON }),
    preview: previewBullet,
    description: 'Простой маркированный список.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Нумерованный список',
    hint: '1.',
    icon: createElement(ListOrdered, { className: ICON }),
    preview: previewOrdered,
    description: 'Список с нумерацией пунктов.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'Список задач',
    icon: createElement(ListChecks, { className: ICON }),
    preview: previewTodo,
    description: 'Чек-лист с галочками.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Цитата',
    icon: createElement(Quote, { className: ICON }),
    preview: previewQuote,
    description: 'Выделенная цитата.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Код',
    icon: createElement(Code, { className: ICON }),
    preview: previewCode,
    description: 'Блок кода с моноширинным шрифтом.',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    label: 'Разделитель',
    hint: '---',
    icon: createElement(Minus, { className: ICON }),
    preview: previewDivider,
    description: 'Горизонтальная линия-разделитель.',
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

// Slash-меню «/» в стиле Notion: вставка блоков. Использует @tiptap/suggestion.
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    const suggestion: Omit<SuggestionOptions<SlashItem>, 'editor'> = {
      char: '/',
      startOfLine: false,
      items: ({ query }) =>
        SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())),
      command: ({ editor, range, props }) => {
        (props as SlashItem).run(editor, range);
      },
      render: createSuggestionRender() as SuggestionOptions<SlashItem>['render'],
    };
    return [Suggestion({ editor: this.editor, ...suggestion })];
  },
});
