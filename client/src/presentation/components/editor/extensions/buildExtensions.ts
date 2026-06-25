import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import type { Extensions } from '@tiptap/core';

import { HighlightMark } from './HighlightMark';
import { createMentionSuggestion, type MentionMember } from './mentionSuggestion';

export type { MentionMember };

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
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    HighlightMark,
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
