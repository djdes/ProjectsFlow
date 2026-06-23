import type { ChatMessageView } from './ChatMessageView.js';
import type { ChatReactionAggregate } from './ChatReaction.js';

// Событие firehose-ленты чата (workspace-scoped ChatEventHub → открытые SSE-вкладки).
// Viewer-agnostic: reactedByMe выводит клиент из userIds.
export type ChatStreamEvent =
  | { readonly kind: 'message_added'; readonly message: ChatMessageView }
  | { readonly kind: 'message_edited'; readonly message: ChatMessageView }
  | { readonly kind: 'message_deleted'; readonly messageId: string; readonly seq: number }
  | {
      readonly kind: 'reaction_changed';
      readonly messageId: string;
      readonly reactions: readonly ChatReactionAggregate[];
    };
