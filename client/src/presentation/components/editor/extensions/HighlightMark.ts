import { Mark, mergeAttributes } from '@tiptap/core';

// Кастомный mark «выделение» с round-trip в `==текст==` (Notion-style ==highlight==).
// Совпадает с рендером read-вью (Markdown.tsx: applyHighlightSyntax → <mark>, whitelist 'mark').
// Тулбар применяет через toggleMark('highlight'), отдельная команда не нужна.
export const HighlightMark = Mark.create({
  name: 'highlight',

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },

  // marked-токенайзер: распознаёт ==текст== как inline-токен.
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src) => src.indexOf('=='),
    tokenize: (src, _tokens, lexer) => {
      const m = /^==([^=]+)==/.exec(src);
      if (!m) return undefined;
      return { type: 'highlight', raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]) };
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.applyMark('highlight', helpers.parseInline(token.tokens ?? [])),

  renderMarkdown: (node, helpers) => `==${helpers.renderChildren(node.content ?? [])}==`,
});
