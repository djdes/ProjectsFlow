import { eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, tasks, urgentTaskReminders, users } from '../db/schema.js';
import type {
  UrgentReminderCandidate,
  UrgentTaskReminderRepository,
} from '../../application/urgent-reminder/UrgentTaskReminderRepository.js';
import type { TaskPriority, TaskStatus } from '../../domain/task/Task.js';
import {
  URGENT_REMINDER_PRIORITIES,
  URGENT_REMINDER_STATUSES,
} from '../../domain/task/urgentTaskReminder.js';
import { activeTasks } from './taskSoftDelete.js';

export class DrizzleUrgentTaskReminderRepository implements UrgentTaskReminderRepository {
  constructor(private readonly db: Database) {}

  // Coarse SQL filter; the exact word rule («не срочно», «несрочно») is the domain's job.
  async listCandidates(): Promise<UrgentReminderCandidate[]> {
    const rows = await this.db
      .select({
        taskId: tasks.id,
        projectId: projects.id,
        projectName: projects.name,
        workspaceId: projects.workspaceId,
        isInbox: projects.isInbox,
        createdBy: tasks.createdBy,
        description: tasks.description,
        priority: tasks.priority,
        status: tasks.status,
        deadline: tasks.deadline,
        assigneeUserId: tasks.assigneeUserId,
        assigneeName: users.displayName,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(users, eq(users.id, tasks.assigneeUserId))
      .where(
        activeTasks(
          inArray(tasks.status, [...URGENT_REMINDER_STATUSES]),
          ne(projects.status, 'archived'),
          isNull(users.deletedAt),
          or(
            inArray(tasks.priority, [...URGENT_REMINDER_PRIORITIES]),
            sql`LOWER(${tasks.description}) LIKE ${'%срочн%'}`,
          ),
        ),
      );
    return rows.map((row) => ({
      ...row,
      priority: (row.priority ?? null) as TaskPriority | null,
      status: row.status as TaskStatus,
      deadline: row.deadline ?? null,
      createdBy: row.createdBy ?? null,
      assigneeName: row.assigneeName || 'Участник',
    }));
  }

  async claim(taskId: string, slotKey: string): Promise<boolean> {
    const [result] = await this.db.insert(urgentTaskReminders).ignore().values({ taskId, slotKey });
    return result.affectedRows > 0;
  }
}
