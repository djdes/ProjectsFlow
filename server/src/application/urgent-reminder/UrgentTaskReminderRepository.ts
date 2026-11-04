import type { TaskPriority, TaskStatus } from '../../domain/task/Task.js';

// Open task that may need an urgent reminder. The repository pre-filters by SQL (not in the
// trash, project not archived, open status, priority 1–2 or «срочн» in the text); the exact
// rule is applied by the use-case through domain/task/urgentTaskReminder.
export type UrgentReminderCandidate = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceId: string;
  // Task without a project: lives in the assignee's personal inbox.
  readonly isInbox: boolean;
  readonly createdBy: string | null;
  readonly description: string | null;
  readonly priority: TaskPriority | null;
  readonly status: TaskStatus;
  readonly deadline: string | null;
  readonly assigneeUserId: string;
  readonly assigneeName: string;
};

export interface UrgentTaskReminderRepository {
  listCandidates(): Promise<UrgentReminderCandidate[]>;
  // Atomically records (task, slot). true — this caller owns the reminder and must send it;
  // false — it was already sent (another tick, a restarted process).
  claim(taskId: string, slotKey: string): Promise<boolean>;
}
