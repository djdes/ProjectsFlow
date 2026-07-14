import { desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskVersions, users, type TaskVersionRow } from '../db/schema.js';
import {
  changedTaskFields,
  type TaskSnapshot,
  type TaskVersion,
  type TaskVersionField,
} from '../../domain/task/TaskVersion.js';
import type {
  CreateTaskVersionInput,
  TaskVersionRepository,
} from '../../application/task/TaskVersionRepository.js';

type VersionRowWithActor = {
  readonly version: TaskVersionRow;
  readonly actorDisplayName: string | null;
  readonly actorAvatarUrl: string | null;
};

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

// Rows created before db/115 contain the smaller legacy snapshot. Keep them readable and
// filterable without pretending that fields absent from the old row had a real value.
function parseSnapshot(value: unknown, projectId: string): TaskSnapshot {
  const raw = parseJson<Partial<TaskSnapshot>>(value);
  return {
    projectId: raw.projectId ?? projectId,
    description: raw.description ?? null,
    assignee: raw.assignee ?? {
      userId: '',
      displayName: 'Не указан',
      avatarUrl: null,
    },
    icon: raw.icon ?? null,
    cover: raw.cover ?? null,
    coverPosition: raw.coverPosition ?? 50,
    status: raw.status ?? 'todo',
    statusBeforeDone: raw.statusBeforeDone ?? null,
    ralphMode: raw.ralphMode ?? 'normal',
    deadline: raw.deadline ?? null,
    startDate: raw.startDate ?? null,
    parentTaskId: raw.parentTaskId ?? null,
    priority: raw.priority ?? null,
    ralphCancelRequestedAt: raw.ralphCancelRequestedAt ?? null,
    ralphCancelRequestedBy: raw.ralphCancelRequestedBy ?? null,
  };
}

function parseChangedFields(value: unknown): TaskVersionField[] | null {
  if (value === null || value === undefined) return null;
  const parsed = parseJson<unknown>(value);
  return Array.isArray(parsed) ? (parsed as TaskVersionField[]) : null;
}

function toVersion(row: VersionRowWithActor): TaskVersion {
  const r = row.version;
  return {
    id: r.id,
    taskId: r.taskId,
    projectId: r.projectId,
    actorUserId: r.actorUserId ?? null,
    actor: r.actorUserId
      ? {
          userId: r.actorUserId,
          displayName: row.actorDisplayName ?? 'Удалённый пользователь',
          avatarUrl: row.actorAvatarUrl ?? null,
        }
      : null,
    changedFields: parseChangedFields(r.changedFields) ?? [],
    snapshot: parseSnapshot(r.snapshot, r.projectId),
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
  };
}

export class DrizzleTaskVersionRepository implements TaskVersionRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateTaskVersionInput): Promise<void> {
    await this.db.insert(taskVersions).values({
      id: input.id,
      taskId: input.taskId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      snapshot: input.snapshot,
      changedFields: [...input.changedFields],
    });
  }

  private selectWithActor() {
    return this.db
      .select({
        version: taskVersions,
        actorDisplayName: users.displayName,
        actorAvatarUrl: users.avatarUrl,
      })
      .from(taskVersions)
      .leftJoin(users, eq(users.id, taskVersions.actorUserId));
  }

  async listForTask(taskId: string): Promise<TaskVersion[]> {
    const rows = await this.selectWithActor()
      .where(eq(taskVersions.taskId, taskId))
      .orderBy(desc(taskVersions.createdAt), desc(taskVersions.id));
    const versions = rows.map((row) => toVersion(row as VersionRowWithActor));

    return versions.map((version, index) => {
      const storedFields = parseChangedFields(rows[index]!.version.changedFields);
      if (storedFields) return version;
      const previous = versions[index + 1]?.snapshot ?? null;
      return { ...version, changedFields: changedTaskFields(previous, version.snapshot) };
    });
  }

  async getById(id: string): Promise<TaskVersion | null> {
    const rows = await this.selectWithActor().where(eq(taskVersions.id, id)).limit(1);
    return rows[0] ? toVersion(rows[0] as VersionRowWithActor) : null;
  }

  async taskIdsWithVersions(taskIds: readonly string[]): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ taskId: taskVersions.taskId })
      .from(taskVersions)
      .where(inArray(taskVersions.taskId, [...taskIds]));
    return new Set(rows.map((r) => r.taskId));
  }
}
