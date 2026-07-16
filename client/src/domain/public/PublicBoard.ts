import type { TaskStatus, TaskPriority } from '@/domain/task/Task';
import type { PublicAppearance } from '@/domain/project/Project';

// Публичная доска (Publish to web). Зеркалит серверный PublicBoard DTO — только whitelisted
// поля (комментарии/финансы/участники сюда не приходят: граница приватности на сервере).
export type PublicTask = {
  readonly id: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly coverPosition: number;
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly deadline: string | null;
};

export type PublicColumn = {
  readonly status: TaskStatus;
  readonly tasks: PublicTask[];
};

export type PublicBoard = {
  readonly slug: string;
  readonly name: string;
  readonly icon: string | null;
  readonly description: string | null;
  readonly coverUrl: string | null;
  readonly coverPosition: number;
  readonly indexing: boolean;
  readonly appearance: PublicAppearance;
  readonly columns: PublicColumn[];
};

// Read-only деталь задачи для окна на публичной доске (тело + фото + комментарии).
export type PublicComment = {
  readonly id: string;
  readonly authorDisplayName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: string;
};

export type PublicTaskDetail = {
  readonly id: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly coverPosition: number;
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly deadline: string | null;
  readonly comments: PublicComment[];
};

// Гейт отдельной страницы задачи: projectId (для редиректа участника) + факт членства.
export type PublicTaskAccess = {
  readonly projectId: string;
  readonly isMember: boolean;
};
