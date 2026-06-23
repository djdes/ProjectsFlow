import type { NotificationRepository } from '../notifications/NotificationRepository.js';

export type DispatchChatMentionInput = {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly messageId: string;
  readonly messageSeq: number;
  readonly messageExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
  readonly mentionedUserIds: readonly string[];
};

type Deps = {
  readonly notifications: NotificationRepository;
  readonly idGen: () => string;
};

// Создаёт in-app уведомление (`chat_mention`) каждому упомянутому участнику. Email/Telegram
// для чата в v1 не шлём (чат — лёгкий канал; см. спеку §5). Best-effort: исключения глотаются.
export class DispatchChatMentionNotifications {
  constructor(private readonly deps: Deps) {}

  async execute(input: DispatchChatMentionInput): Promise<void> {
    for (const userId of input.mentionedUserIds) {
      if (userId === input.actorUserId) continue;
      try {
        await this.deps.notifications.create({
          id: this.deps.idGen(),
          userId,
          payload: {
            type: 'chat_mention',
            workspaceId: input.workspaceId,
            workspaceName: input.workspaceName,
            messageId: input.messageId,
            messageSeq: input.messageSeq,
            messageExcerpt: input.messageExcerpt,
            actorUserId: input.actorUserId,
            actorDisplayName: input.actorDisplayName,
          },
        });
      } catch {
        // Best-effort — не валим отправку сообщения из-за уведомления.
      }
    }
  }
}
