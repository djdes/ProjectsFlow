import { aliasedTable, and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, taskDelegations, tasks, users } from '../db/schema.js';
import type {
  CreateDelegationInput,
  DelegationWithTaskInfo,
  TaskDelegationRepository,
} from '../../application/task/TaskDelegationRepository.js';
import type {
  TaskDelegation,
  TaskDelegationStatus,
} from '../../domain/task/TaskDelegation.js';

const TASK_EXCERPT_LEN = 120;
const ACTIVE_STATUSES: readonly TaskDelegationStatus[] = ['pending', 'accepted'];

type DelegationRowRaw = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegateDisplayName: string;
  creatorUserId: string;
  creatorDisplayName: string;
  status: TaskDelegationStatus;
  createdAt: Date;
  respondedAt: Date | null;
};

function toDomain(r: DelegationRowRaw): TaskDelegation {
  return {
    id: r.id,
    taskId: r.taskId,
    delegateUserId: r.delegateUserId,
    delegateDisplayName: r.delegateDisplayName,
    creatorUserId: r.creatorUserId,
    creatorDisplayName: r.creatorDisplayName,
    status: r.status,
    createdAt: r.createdAt,
    respondedAt: r.respondedAt,
  };
}

export class DrizzleTaskDelegationRepository implements TaskDelegationRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateDelegationInput): Promise<TaskDelegation> {
    await this.db.insert(taskDelegations).values({
      id: input.id,
      taskId: input.taskId,
      delegateUserId: input.delegateUserId,
      status: 'pending',
    });
    const created = await this.getById(input.id);
    if (!created) {
      throw new Error('Failed to read back delegation after insert');
    }
    return created;
  }

  async findActiveForTask(taskId: string): Promise<TaskDelegation | null> {
    const rows = await this.selectJoined()
      .where(
        and(
          eq(taskDelegations.taskId, taskId),
          inArray(taskDelegations.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getById(id: string): Promise<TaskDelegation | null> {
    const rows = await this.selectJoined()
      .where(eq(taskDelegations.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async setStatus(
    id: string,
    status: TaskDelegationStatus,
  ): Promise<TaskDelegation | null> {
    await this.db
      .update(taskDelegations)
      .set({ status, respondedAt: new Date() })
      .where(eq(taskDelegations.id, id));
    return this.getById(id);
  }

  async listPendingForDelegate(userId: string): Promise<DelegationWithTaskInfo[]> {
    const delegateUser = aliasedTable(users, 'delegate_user');
    const creatorUser = aliasedTable(users, 'creator_user');
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: delegateUser.displayName,
        creatorUserId: projects.ownerId,
        creatorDisplayName: creatorUser.displayName,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
        taskDescription: tasks.description,
      })
      .from(taskDelegations)
      .innerJoin(delegateUser, eq(delegateUser.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(creatorUser, eq(creatorUser.id, projects.ownerId))
      .where(
        and(
          eq(taskDelegations.delegateUserId, userId),
          eq(taskDelegations.status, 'pending'),
        ),
      );

    return rows.map((r) => ({
      ...toDomain({
        id: r.id,
        taskId: r.taskId,
        delegateUserId: r.delegateUserId,
        delegateDisplayName: r.delegateDisplayName,
        creatorUserId: r.creatorUserId,
        creatorDisplayName: r.creatorDisplayName,
        status: r.status,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt,
      }),
      taskExcerpt: (r.taskDescription ?? '').slice(0, TASK_EXCERPT_LEN),
    }));
  }

  async listActiveForTasks(
    taskIds: readonly string[],
  ): Promise<Map<string, TaskDelegation>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.selectJoined().where(
      and(
        inArray(taskDelegations.taskId, [...taskIds]),
        inArray(taskDelegations.status, [...ACTIVE_STATUSES]),
      ),
    );
    const map = new Map<string, TaskDelegation>();
    for (const r of rows) {
      map.set(r.taskId, toDomain(r));
    }
    return map;
  }

  // Базовый join: delegate (users) + tasks + projects (для creator owner_id) + creator (users).
  // Используем aliasedTable чтобы дважды join'ить users без коллизии имён.
  private selectJoined() {
    const delegateUser = aliasedTable(users, 'delegate_user');
    const creatorUser = aliasedTable(users, 'creator_user');
    return this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: delegateUser.displayName,
        creatorUserId: projects.ownerId,
        creatorDisplayName: creatorUser.displayName,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
      })
      .from(taskDelegations)
      .innerJoin(delegateUser, eq(delegateUser.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(creatorUser, eq(creatorUser.id, projects.ownerId));
  }
}
