import { createElement } from 'react';
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

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'text',
    label: 'Текст',
    icon: createElement(Text, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    id: 'h1',
    label: 'Заголовок 1',
    icon: createElement(Heading1, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Заголовок 2',
    icon: createElement(Heading2, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Заголовок 3',
    icon: createElement(Heading3, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Маркированный список',
    icon: createElement(List, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Нумерованный список',
    icon: createElement(ListOrdered, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'Список задач',
    icon: createElement(ListChecks, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Цитата',
    icon: createElement(Quote, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Код',
    icon: createElement(Code, { className: ICON }),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    label: 'Разделитель',
    icon: createElement(Minus, { className: ICON }),
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
