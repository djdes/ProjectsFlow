import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import {
  TextStyle as BaseTextStyle,
  Color,
  BackgroundColor,
} from '@tiptap/extension-text-style';
import type { Extensions, JSONContent } from '@tiptap/core';

import { HighlightMark } from './HighlightMark';
import { FigureImage } from './FigureImage';
import { BlockMovedHighlight } from './blockMovedHighlight';
import { createMentionSuggestion, type MentionMember } from './mentionSuggestion';

export type { MentionMember };

// TextStyle сериализует цвет текста/фона в inline-HTML, чтобы он пережил round-trip
// markdown ↔ doc. Базовый TextStyle парсит `<span style>` (parseHTML), но НЕ умеет
// рендерить его в markdown — getMarkdown() молча терял бы style. Добавляем renderMarkdown:
// `<span style="color:…;background-color:…">текст</span>`. Read-вью (Markdown.tsx)
// разрешает ровно эти style-свойства в SANITIZE_SCHEMA — связка симметрична.
const TextStyle = BaseTextStyle.extend({
  renderMarkdown(node: JSONContent, helpers: { renderChildren: (n: JSONContent[]) => string }) {
    const attrs = (node.attrs ?? {}) as { color?: string | null; backgroundColor?: string | null };
    const styles: string[] = [];
    if (attrs.color) styles.push(`color:${attrs.color}`);
    if (attrs.backgroundColor) styles.push(`background-color:${attrs.backgroundColor}`);
    const inner = helpers.renderChildren(node.content ?? []);
    if (styles.length === 0) return inner; // пустой textStyle — без обёртки
    return `<span style="${styles.join(';')}">${inner}</span>`;
  },
});

interface BuildExtensionsOptions {
  placeholder?: string;
  /** Если переданы — включается @-упоминание участников. */
  members?: MentionMember[];
}

// Единый источник набора расширений редактора. Хранение остаётся markdown-строкой:
// Markdown-расширение даёт getMarkdown()/setContent({contentType:'markdown'}).
export function buildExtensions({ placeholder, members }: BuildExtensionsOptions = {}): Extensions {
  const extensions: Extensions = [
    // StarterKit v3 уже включает Bold/Italic/Strike/Code/Underline/Link + heading/списки/quote/codeBlock/hr/history.
    // dropcursor — линия места вставки при перетаскивании блока. Цвет — тот же синий, что и
    // подсветка перемещённого блока (.pf-block-moved), только заметнее (rgb 35,131,226).
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      dropcursor: { color: 'rgba(35, 131, 226, 0.5)', width: 3 },
    }),
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    HighlightMark,
    // Пастельно-синяя подсветка только что перетащенного блока (Notion-style). См. blockMovedHighlight.ts.
    BlockMovedHighlight,
    // Блок-картинка с подписью (inline-скрины в описании). См. FigureImage.ts.
    FigureImage,
    // Цвет текста/фона через textStyle-mark. Color/BackgroundColor добавляют
    // глобальные атрибуты color/backgroundColor к textStyle и команды
    // setColor/setBackgroundColor (см. меню форматирования).
    TextStyle,
    Color,
    BackgroundColor,
    Placeholder.configure({ placeholder: placeholder ?? '' }),
  ];

  if (members && members.length > 0) {
    // mention-нода сериализуется в literal `@displayName` (совместимо с серверным parseMentions).
    const MentionMarkdown = Mention.extend({
      renderMarkdown: (node) => `@${(node.attrs?.label as string) ?? node.attrs?.id ?? ''}`,
    });
    extensions.push(
      MentionMarkdown.configure({
        HTMLAttributes: { class: 'pf-mention' },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        suggestion: createMentionSuggestion(members),
      }),
    );
  }

  return extensions;
}
