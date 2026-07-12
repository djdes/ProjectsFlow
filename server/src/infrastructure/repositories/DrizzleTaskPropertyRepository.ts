import { asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskProperties, taskPropertyValues, type TaskPropertyRow } from '../db/schema.js';
import type {
  TaskProperty,
  TaskPropertyOption,
  TaskPropertyType,
  TaskPropertyValue,
} from '../../domain/task/TaskProperty.js';
import type {
  CreateTaskPropertyInput,
  TaskPropertyRepository,
  UpdateTaskPropertyPatch,
} from '../../application/task/TaskPropertyRepository.js';

function parseOptions(raw: string | null): TaskPropertyOption[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TaskPropertyOption[]) : [];
  } catch {
    return [];
  }
}

function toDomain(row: TaskPropertyRow): TaskProperty {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type: row.type as TaskPropertyType,
    options: parseOptions(row.options),
    position: row.position,
  };
}

export class DrizzleTaskPropertyRepository implements TaskPropertyRepository {
  constructor(private readonly db: Database) {}

  async listForProject(projectId: string): Promise<TaskProperty[]> {
    const rows = await this.db
      .select()
      .from(taskProperties)
      .where(eq(taskProperties.projectId, projectId))
      .orderBy(asc(taskProperties.position), asc(taskProperties.createdAt));
    return rows.map(toDomain);
  }

  async getById(id: string): Promise<TaskProperty | null> {
    const rows = await this.db
      .select()
      .from(taskProperties)
      .where(eq(taskProperties.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(input: CreateTaskPropertyInput): Promise<TaskProperty> {
    // position — в конец списка свойств проекта.
    const existing = await this.listForProject(input.projectId);
    const position = existing.length
      ? Math.max(...existing.map((p) => p.position)) + 1
      : 0;
    await this.db.insert(taskProperties).values({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      options: input.options.length ? JSON.stringify(input.options) : null,
      position,
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back task property after insert');
    return created;
  }

  async update(id: string, patch: UpdateTaskPropertyPatch): Promise<TaskProperty | null> {
    const set: Partial<{ name: string; options: string | null }> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.options !== undefined)
      set.options = patch.options.length ? JSON.stringify(patch.options) : null;
    if (Object.keys(set).length > 0) {
      await this.db.update(taskProperties).set(set).where(eq(taskProperties.id, id));
    }
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(taskPropertyValues).where(eq(taskPropertyValues.propertyId, id));
      await tx.delete(taskProperties).where(eq(taskProperties.id, id));
    });
  }

  async listValuesForProject(projectId: string): Promise<TaskPropertyValue[]> {
    const props = await this.db
      .select({ id: taskProperties.id })
      .from(taskProperties)
      .where(eq(taskProperties.projectId, projectId));
    if (props.length === 0) return [];
    const rows = await this.db
      .select()
      .from(taskPropertyValues)
      .where(
        inArray(
          taskPropertyValues.propertyId,
          props.map((p) => p.id),
        ),
      );
    return rows.map((r) => ({
      taskId: r.taskId,
      propertyId: r.propertyId,
      value: r.value ?? '',
    }));
  }

  async setValue(taskId: string, propertyId: string, value: string): Promise<void> {
    await this.db
      .insert(taskPropertyValues)
      .values({ taskId, propertyId, value })
      .onDuplicateKeyUpdate({ set: { value } });
  }
}
