import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, type ProjectRow } from '../db/schema.js';
import type { Project, ProjectStatus } from '../../domain/project/Project.js';
import { ProjectNameAlreadyExistsError } from '../../domain/project/errors.js';
import type {
  CreateProjectInput,
  ProjectRepository,
  UpdateProjectInput,
} from '../../application/project/ProjectRepository.js';

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    status: row.status as ProjectStatus,
    gitRepoUrl: row.gitRepoUrl ?? null,
    createdAt: row.createdAt,
  };
}

// MySQL ER_DUP_ENTRY = 1062
function isDuplicateKey(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  const errno = (err as { errno?: number }).errno;
  return code === 'ER_DUP_ENTRY' || errno === 1062;
}

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: Database) {}

  async listByOwner(ownerId: string): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.ownerId, ownerId))
      .orderBy(desc(projects.createdAt), asc(projects.id));
    return rows.map(toProject);
  }

  async getByIdForOwner(id: string, ownerId: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
      .limit(1);
    const row = rows[0];
    return row ? toProject(row) : null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    try {
      await this.db.insert(projects).values({
        id: input.id,
        ownerId: input.ownerId,
        name: input.name,
        status: 'active',
        gitRepoUrl: null,
      });
    } catch (err) {
      if (isDuplicateKey(err)) throw new ProjectNameAlreadyExistsError(input.name);
      throw err;
    }
    const rows = await this.db.select().from(projects).where(eq(projects.id, input.id)).limit(1);
    const row = rows[0];
    if (!row) throw new Error('Failed to read back project after insert');
    return toProject(row);
  }

  async update(id: string, ownerId: string, patch: UpdateProjectInput): Promise<Project | null> {
    // Собираем set-объект только из реально переданных полей.
    // undefined = поле не указано клиентом (не трогаем), null = очистить.
    const set: Partial<Pick<ProjectRow, 'name' | 'gitRepoUrl'>> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.gitRepoUrl !== undefined) set.gitRepoUrl = patch.gitRepoUrl;

    if (Object.keys(set).length > 0) {
      try {
        await this.db
          .update(projects)
          .set(set)
          .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)));
      } catch (err) {
        if (isDuplicateKey(err)) throw new ProjectNameAlreadyExistsError(patch.name ?? '');
        throw err;
      }
    }

    return this.getByIdForOwner(id, ownerId);
  }
}
