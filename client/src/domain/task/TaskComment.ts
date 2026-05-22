import type { TaskAttachment } from './TaskAttachment';

export type TaskComment = {
  readonly id: string;
  readonly taskId: string;
  readonly ownerUserId: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Вложения комментария (на list-эндпоинте). На create — пусто (грузятся отдельно).
  readonly attachments: TaskAttachment[];
};
