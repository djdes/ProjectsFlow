import type { TaskStatus, TaskPriority } from '@/domain/task/Task';

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
  readonly columns: PublicColumn[];
};
