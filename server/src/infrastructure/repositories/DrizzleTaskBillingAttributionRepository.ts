import { and, desc, eq } from 'drizzle-orm';
import type { TaskBillingAttributionRepository } from '../../application/usage/TaskBillingAttributionRepository.js';
import type { Database } from '../db/index.js';
import { projects, taskDelegations, tasks } from '../db/schema.js';

export class DrizzleTaskBillingAttributionRepository
  implements TaskBillingAttributionRepository
{
  constructor(private readonly db: Database) {}

  // БЕЗ фильтра deleted_at (db/134) намеренно: атрибуция расхода должна работать и по
  // задаче, уехавшей в корзину, иначе биллинг теряет плательщика уже начисленных трат.
  async findLegacyCreatorForTask(taskId: string): Promise<string | null> {
    const rows = await this.db
      .select({
        creatorUserId: taskDelegations.delegatorUserId,
        projectOwnerId: projects.ownerId,
      })
      .from(taskDelegations)
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(taskDelegations.taskId, taskId),
          eq(taskDelegations.status, 'accepted'),
        ),
      )
      .orderBy(desc(taskDelegations.respondedAt), desc(taskDelegations.createdAt))
      .limit(1);
    const row = rows[0];
    return row?.creatorUserId ?? row?.projectOwnerId ?? null;
  }
}
