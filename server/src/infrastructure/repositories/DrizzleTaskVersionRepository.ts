import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskVersions, type TaskVersionRow } from '../db/schema.js';
import type { TaskSnapshot, TaskVersion } from '../../domain/task/TaskVersion.js';
import type {
  CreateTaskVersionInput,
  TaskVersionRepository,
} from '../../application/task/TaskVersionRepository.js';

// MariaDB JSON приходит строкой ИЛИ уже объектом (в зависимости от драйвера) — парсим устойчиво.
function parseSnapshot(v: unknown): TaskSnapshot {
  if (typeof v === 'string') return JSON.parse(v) as TaskSnapshot;
  return v as TaskSnapshot;
}

function toVersion(r: TaskVersionRow): TaskVersion {
  return {
    id: r.id,
    taskId: r.taskId,
    projectId: r.projectId,
    actorUserId: r.actorUserId ?? null,
    snapshot: parseSnapshot(r.snapshot),
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
    });
  }

  async listForTask(taskId: string): Promise<TaskVersion[]> {
    const rows = await this.db
      .select()
      .from(taskVersions)
      .where(eq(taskVersions.taskId, taskId))
      .orderBy(desc(taskVersions.createdAt));
    return rows.map(toVersion);
  }

  async getById(id: string): Promise<TaskVersion | null> {
    const rows = await this.db.select().from(taskVersions).where(eq(taskVersions.id, id)).limit(1);
    return rows[0] ? toVersion(rows[0]) : null;
  }
}
