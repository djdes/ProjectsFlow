import type { RalphMode, Task, TaskPriority, TaskStatus } from './Task.js';

// Снимок изменяемых полей задачи — то, что восстанавливает «Восстановить» (вся задача к версии).
export type TaskSnapshot = {
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly statusBeforeDone: TaskStatus | null;
  readonly ralphMode: RalphMode;
  readonly deadline: string | null;
  readonly priority: TaskPriority | null;
};

// Версия задачи (одна запись истории).
export type TaskVersion = {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly actorUserId: string | null;
  readonly snapshot: TaskSnapshot;
  readonly createdAt: Date;
};

// Снимок текущего состояния задачи.
export function snapshotOfTask(task: Task): TaskSnapshot {
  return {
    description: task.description,
    status: task.status,
    statusBeforeDone: task.statusBeforeDone,
    ralphMode: task.ralphMode,
    deadline: task.deadline,
    priority: task.priority,
  };
}
