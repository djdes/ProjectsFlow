import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  kbDocuments,
  projectEmployeeAssignments,
  projectExpenses,
  projectGitTokenAccessLog,
  projectGitTokenDelegations,
  projectIncomes,
  projectInvites,
  projectJoinRequests,
  projectMembers,
  projects,
  secrets,
  taskAttachments,
  taskComments,
  taskCommits,
  tasks,
  type ProjectRow,
} from '../db/schema.js';
import type { Project, ProjectStatus } from '../../domain/project/Project.js';
import { ProjectNameAlreadyExistsError } from '../../domain/project/errors.js';
import type {
  CreateProjectInput,
  ProjectRepository,
  UpdateProjectInput,
} from '../../application/project/ProjectRepository.js';
import type { KanbanBoardSettings } from '../../domain/kanban/KanbanSettings.js';
import { parseJsonCol } from './jsonCol.js';

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    icon: row.icon ?? null,
    status: row.status as ProjectStatus,
    gitRepoUrl: row.gitRepoUrl ?? null,
    kbRepoFullName: row.kbRepoFullName ?? null,
    isInbox: row.isInbox,
    kbKind: row.kbKind,
    financeVisibility: row.financeVisibility,
    dispatcherUserId: row.dispatcherUserId ?? null,
    multiTaskWorker: row.multiTaskWorker,
    description: row.description ?? null,
    coverUrl: row.coverUrl ?? null,
    coverPosition: row.coverPosition,
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

  async getById(id: string): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    const row = rows[0];
    return row ? toProject(row) : null;
  }

  async findInboxByOwner(ownerId: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerId, ownerId), eq(projects.isInbox, true)))
      .limit(1);
    const row = rows[0];
    return row ? toProject(row) : null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    try {
      await this.db.insert(projects).values({
        id: input.id,
        workspaceId: input.workspaceId,
        ownerId: input.ownerId,
        name: input.name,
        status: 'active',
        gitRepoUrl: null,
        isInbox: input.isInbox ?? false,
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

  async createWithOwnerMembership(input: CreateProjectInput): Promise<Project> {
    // Одна транзакция: project + owner-membership. Без TX был баг — если
    // member.add падал после repo.create, проект оставался orphan'ом (никакой
    // requireProjectAccess не пропустил бы даже создателя).
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(projects).values({
          id: input.id,
          workspaceId: input.workspaceId,
          ownerId: input.ownerId,
          name: input.name,
          status: 'active',
          gitRepoUrl: null,
          isInbox: input.isInbox ?? false,
        });
        await tx.insert(projectMembers).values({
          projectId: input.id,
          userId: input.ownerId,
          role: 'owner',
        });
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

  async update(id: string, patch: UpdateProjectInput): Promise<Project | null> {
    // Собираем set-объект только из реально переданных полей.
    // undefined = поле не указано клиентом (не трогаем), null = очистить.
    const set: Partial<Pick<ProjectRow, 'name' | 'icon' | 'gitRepoUrl' | 'kbRepoFullName' | 'kbKind' | 'financeVisibility' | 'dispatcherUserId' | 'multiTaskWorker' | 'status' | 'description' | 'coverUrl' | 'coverPosition'>> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.gitRepoUrl !== undefined) set.gitRepoUrl = patch.gitRepoUrl;
    if (patch.kbRepoFullName !== undefined) set.kbRepoFullName = patch.kbRepoFullName;
    if (patch.kbKind !== undefined) set.kbKind = patch.kbKind;
    if (patch.financeVisibility !== undefined) set.financeVisibility = patch.financeVisibility;
    if (patch.dispatcherUserId !== undefined) set.dispatcherUserId = patch.dispatcherUserId;
    if (patch.multiTaskWorker !== undefined) set.multiTaskWorker = patch.multiTaskWorker;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.coverUrl !== undefined) set.coverUrl = patch.coverUrl;
    if (patch.coverPosition !== undefined) set.coverPosition = patch.coverPosition;

    if (Object.keys(set).length > 0) {
      try {
        await this.db.update(projects).set(set).where(eq(projects.id, id));
      } catch (err) {
        if (isDuplicateKey(err)) throw new ProjectNameAlreadyExistsError(patch.name ?? '');
        throw err;
      }
    }

    return this.getById(id);
  }

  async setWorkspace(projectId: string, workspaceId: string): Promise<void> {
    try {
      await this.db.update(projects).set({ workspaceId }).where(eq(projects.id, projectId));
    } catch (err) {
      // Конфликт имени в целевом пространстве (uq_projects_workspace_name).
      if (isDuplicateKey(err)) throw new ProjectNameAlreadyExistsError('');
      throw err;
    }
  }

  async getWorkspaceId(projectId: string): Promise<string | null> {
    const rows = await this.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0]?.workspaceId ?? null;
  }

  async listByWorkspace(workspaceId: string): Promise<Array<{ id: string; name: string; icon: string | null }>> {
    const rows = await this.db
      .select({ id: projects.id, name: projects.name, icon: projects.icon })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.isInbox, false)))
      .orderBy(projects.createdAt);
    return rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon ?? null }));
  }

  async listWithGitRepo(): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(isNotNull(projects.gitRepoUrl));
    return rows.map(toProject);
  }

  async listDispatchedByUser(userId: string): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.dispatcherUserId, userId));
    return rows.map(toProject);
  }

  async clearDispatcherForUser(userId: string): Promise<number> {
    const result = await this.db
      .update(projects)
      .set({ dispatcherUserId: null })
      .where(eq(projects.dispatcherUserId, userId));
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }

  async getKanbanSettings(projectId: string): Promise<KanbanBoardSettings | null> {
    const rows = await this.db
      .select({ settings: projects.kanbanSettings })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return parseJsonCol<KanbanBoardSettings | null>(rows[0]?.settings, null);
  }

  async setKanbanSettings(projectId: string, settings: KanbanBoardSettings): Promise<void> {
    // Полная замена JSON-блоба — клиент присылает уже смерженную карту.
    await this.db
      .update(projects)
      .set({ kanbanSettings: settings })
      .where(eq(projects.id, projectId));
  }

  async deleteCascade(projectId: string): Promise<void> {
    // Одна транзакция: или всё, или ничего. FK ON DELETE CASCADE на схеме нет
    // (см. db/*.sql) — вручную чистим в порядке children → parent.
    await this.db.transaction(async (tx) => {
      // Список task-ID этого проекта — нужен для удаления task_attachments/
      // task_comments/task_commits, у которых FK по task_id, а не по project_id.
      const taskIds = (
        await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.projectId, projectId))
      ).map((r) => r.id);

      if (taskIds.length > 0) {
        await tx.delete(taskAttachments).where(inArray(taskAttachments.taskId, taskIds));
        await tx.delete(taskComments).where(inArray(taskComments.taskId, taskIds));
        await tx.delete(taskCommits).where(inArray(taskCommits.taskId, taskIds));
      }

      // Удаляем сами task'и после очистки их child-таблиц.
      await tx.delete(tasks).where(eq(tasks.projectId, projectId));

      // Прочие project-scoped таблицы. Порядок между ними не важен.
      await tx.delete(kbDocuments).where(eq(kbDocuments.projectId, projectId));
      await tx.delete(secrets).where(eq(secrets.projectId, projectId));
      await tx.delete(projectEmployeeAssignments).where(eq(projectEmployeeAssignments.projectId, projectId));
      await tx.delete(projectExpenses).where(eq(projectExpenses.projectId, projectId));
      await tx.delete(projectIncomes).where(eq(projectIncomes.projectId, projectId));
      await tx.delete(projectInvites).where(eq(projectInvites.projectId, projectId));
      await tx.delete(projectJoinRequests).where(eq(projectJoinRequests.projectId, projectId));
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
      // Git-token delegation + audit-log (см. db/029).
      await tx
        .delete(projectGitTokenAccessLog)
        .where(eq(projectGitTokenAccessLog.projectId, projectId));
      await tx
        .delete(projectGitTokenDelegations)
        .where(eq(projectGitTokenDelegations.projectId, projectId));

      // Финальный — сам проект.
      await tx.delete(projects).where(eq(projects.id, projectId));
    });
  }
}
