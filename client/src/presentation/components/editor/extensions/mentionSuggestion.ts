import type { MentionOptions } from '@tiptap/extension-mention';

import { createSuggestionRender } from '../suggestionRender';
import type { SuggestionItem } from '../SuggestionList';

export interface MentionMember {
  userId: string;
  displayName: string;
}

// @-упоминания: данные = участники проекта; вставляется mention-нода с attrs {id,label},
// label = displayName. renderMarkdown ноды (см. buildExtensions) сериализует в `@displayName`
// — совместимо с серверным parseMentions.
export function createMentionSuggestion(
  members: MentionMember[],
): MentionOptions['suggestion'] {
  return {
    char: '@',
    // Меню — только пока в поле печатают. Иначе оно открывалось само при открытии задачи:
    // курсор стоит в конце описания, а там «@имя» из текста.
    allow: ({ editor }) => editor.isFocused,
    items: ({ query }): SuggestionItem[] => {
      const q = query.toLowerCase();
      return members
        .filter((m) => m.displayName.toLowerCase().includes(q))
        .slice(0, 8)
        .map((m) => ({ id: m.userId, label: m.displayName }));
    },
    command: ({ editor, range, props }) => {
      const item = props as unknown as SuggestionItem;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'mention', attrs: { id: item.id, label: item.label } },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
    render: createSuggestionRender(),
  };
}
