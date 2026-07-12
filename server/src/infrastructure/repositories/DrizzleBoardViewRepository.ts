import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { boardViews, type BoardViewRow } from '../db/schema.js';
import type { BoardView, BoardViewType } from '../../domain/project/BoardView.js';
import type {
  BoardViewRepository,
  CreateBoardViewInput,
} from '../../application/project/BoardViewRepository.js';

// MariaDB отдаёт JSON-колонку строкой (LONGTEXT-алиас) — drizzle её не парсит.
function parseJsonCol<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function toDomain(row: BoardViewRow): BoardView {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type: row.type as BoardViewType,
    sortOrder: row.sortOrder,
    config: parseJsonCol<Record<string, unknown> | null>(row.config, null),
    createdAt: row.createdAt,
  };
}

export class DrizzleBoardViewRepository implements BoardViewRepository {
  constructor(private readonly db: Database) {}

  async listForProject(projectId: string): Promise<BoardView[]> {
    const rows = await this.db
      .select()
      .from(boardViews)
      .where(eq(boardViews.projectId, projectId))
      .orderBy(asc(boardViews.sortOrder), asc(boardViews.createdAt));
    return rows.map(toDomain);
  }

  async getById(id: string): Promise<BoardView | null> {
    const rows = await this.db.select().from(boardViews).where(eq(boardViews.id, id)).limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(input: CreateBoardViewInput): Promise<BoardView> {
    // В конец ряда вкладок: MAX(sort_order) по проекту + 1 (у пустого проекта — 1).
    const maxRows = await this.db
      .select({ max: sql<number | null>`MAX(${boardViews.sortOrder})` })
      .from(boardViews)
      .where(eq(boardViews.projectId, input.projectId));
    const sortOrder = (maxRows[0]?.max ?? 0) + 1;
    await this.db.insert(boardViews).values({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      sortOrder,
      createdBy: input.createdBy,
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to read back board view after insert');
    return created;
  }

  async update(
    id: string,
    patch: {
      name?: string;
      type?: BoardViewType;
      sortOrder?: number;
      config?: Record<string, unknown> | null;
    },
  ): Promise<BoardView | null> {
    const set: Partial<{
      name: string;
      type: BoardViewType;
      sortOrder: number;
      config: Record<string, unknown> | null;
    }> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
    if (patch.config !== undefined) set.config = patch.config;
    if (Object.keys(set).length > 0) {
      await this.db.update(boardViews).set(set).where(eq(boardViews.id, id));
    }
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(boardViews).where(eq(boardViews.id, id));
  }
}
