import { aliasedTable, and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, taskDelegations, tasks, users } from '../db/schema.js';
import type {
  AssignedDelegationRow,
  CreateDelegationInput,
  DelegatedByRow,
  DelegationWithTaskInfo,
  TaskDelegationRepository,
} from '../../application/task/TaskDelegationRepository.js';
import type {
  TaskDelegation,
  TaskDelegationStatus,
} from '../../domain/task/TaskDelegation.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

const TASK_EXCERPT_LEN = 120;
const ACTIVE_STATUSES: readonly TaskDelegationStatus[] = ['pending', 'accepted'];

// Сырой ряд join'а. Делегатор = delegator_user_id (persisted, db/054; для legacy-строк
// backfill = owner проекта), фолбэк-id — projects.owner_id. Имя делегатора берём
// корелированным подзапросом (а НЕ leftJoin'ом aliasedTable — он ломает type-inference
// Drizzle, даёт never[]); фолбэк имени — owner проекта (ownerUser innerJoin). COALESCE в JS.
type DelegationRowRaw = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegateDisplayName: string;
  delegatorUserId: string | null;
  ownerId: string;
  delegatorDisplayName: string | null;
  ownerDisplayName: string;
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
    creatorUserId: r.delegatorUserId ?? r.ownerId,
    creatorDisplayName: r.delegatorDisplayName ?? r.ownerDisplayName,
    status: r.status,
    createdAt: r.createdAt,
    respondedAt: r.respondedAt,
  };
}

// Имя делегатора по delegator_user_id — корелированный подзапрос (без лишнего join'а).
const delegatorNameSql = sql<
  string | null
>`(SELECT du.display_name FROM users du WHERE du.id = ${taskDelegations.delegatorUserId})`;

export class DrizzleTaskDelegationRepository implements TaskDelegationRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateDelegationInput): Promise<TaskDelegation> {
    // Runtime-guard: новые строки всегда знают делегатора (порт требует это compile-time,
    // но страхуемся от any-каста на границе).
    if (!input.delegatorUserId) {
      throw new Error('createDelegation: delegatorUserId is required');
    }
    await this.db.insert(taskDelegations).values({
      id: input.id,
      taskId: input.taskId,
      delegateUserId: input.delegateUserId,
      delegatorUserId: input.delegatorUserId,
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
    const ownerUser = aliasedTable(users, 'owner_user');
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: delegateUser.displayName,
        delegatorUserId: taskDelegations.delegatorUserId,
        ownerId: projects.ownerId,
        delegatorDisplayName: delegatorNameSql,
        ownerDisplayName: ownerUser.displayName,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
        taskDescription: tasks.description,
      })
      .from(taskDelegations)
      .innerJoin(delegateUser, eq(delegateUser.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(ownerUser, eq(ownerUser.id, projects.ownerId))
      .where(
        and(
          eq(taskDelegations.delegateUserId, userId),
          eq(taskDelegations.status, 'pending'),
        ),
      );

    return rows.map((r) => ({
      ...toDomain(r),
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

  // Базовый join (4 innerJoin'а — как было исторически; leftJoin aliasedTable ломает
  // inference): delegate + tasks + projects + owner. Имя делегатора — подзапрос. Строка
  // никогда не пропадает: findActiveForTask/getById/listActiveForTasks гейтят авторизацию.
  private selectJoined() {
    const delegateUser = aliasedTable(users, 'delegate_user');
    const ownerUser = aliasedTable(users, 'owner_user');
    return this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: delegateUser.displayName,
        delegatorUserId: taskDelegations.delegatorUserId,
        ownerId: projects.ownerId,
        delegatorDisplayName: delegatorNameSql,
        ownerDisplayName: ownerUser.displayName,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
      })
      .from(taskDelegations)
      .innerJoin(delegateUser, eq(delegateUser.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(ownerUser, eq(ownerUser.id, projects.ownerId));
  }

  // Все активные (pending|accepted) делегации НА userId по всем проектам — для блока
  // «Поручено мне». Лёгкие строки (id задачи + делегация + контекст проекта + моя роль);
  // полный Task use-case достаёт батчем через TaskRepository.listByIds. Имя делегатора и
  // моя роль — корелированные подзапросы (без 5-го/left join'а, который ломает inference).
  async listAssignedTo(userId: string): Promise<AssignedDelegationRow[]> {
    const delegateUser = aliasedTable(users, 'delegate_user');
    const ownerUser = aliasedTable(users, 'owner_user');
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: delegateUser.displayName,
        delegatorUserId: taskDelegations.delegatorUserId,
        ownerId: projects.ownerId,
        delegatorDisplayName: delegatorNameSql,
        ownerDisplayName: ownerUser.displayName,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
        projectId: projects.id,
        projectName: projects.name,
        isInbox: projects.isInbox,
        delegateRole: sql<ProjectRole | null>`(SELECT pm.role FROM project_members pm WHERE pm.project_id = ${projects.id} AND pm.user_id = ${userId} LIMIT 1)`,
      })
      .from(taskDelegations)
      .innerJoin(delegateUser, eq(delegateUser.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(ownerUser, eq(ownerUser.id, projects.ownerId))
      .where(
        and(
          eq(taskDelegations.delegateUserId, userId),
          inArray(taskDelegations.status, [...ACTIVE_STATUSES]),
        ),
      );

    return rows.map((r) => ({
      taskId: r.taskId,
      delegation: toDomain(r),
      projectId: r.projectId,
      projectName: r.projectName,
      isInbox: Boolean(r.isInbox),
      delegateRole: r.delegateRole ?? null,
    }));
  }

  // Все активные (pending|accepted) делегации ОТ userId (он — делегатор) по всем проектам —
  // для вкладки «Другим». Зеркало listAssignedTo с обратным фильтром: delegator_user_id =
  // userId, для legacy-строк (delegator NULL) — фолбэк на owner проекта (как в toDomain).
  // delegateRole — роль делегата (фильтр «делегата убрали»); creatorRole — роль caller'а
  // (canModify). Оба — корелированные подзапросы (left join ломает inference).
  async listDelegatedBy(userId: string): Promise<DelegatedByRow[]> {
    const delegateUser = aliasedTable(users, 'delegate_user');
    const ownerUser = aliasedTable(users, 'owner_user');
    const rows = await this.db
      .select({
        id: taskDelegations.id,
        taskId: taskDelegations.taskId,
        delegateUserId: taskDelegations.delegateUserId,
        delegateDisplayName: delegateUser.displayName,
        delegatorUserId: taskDelegations.delegatorUserId,
        ownerId: projects.ownerId,
        delegatorDisplayName: delegatorNameSql,
        ownerDisplayName: ownerUser.displayName,
        status: taskDelegations.status,
        createdAt: taskDelegations.createdAt,
        respondedAt: taskDelegations.respondedAt,
        projectId: projects.id,
        projectName: projects.name,
        isInbox: projects.isInbox,
        delegateRole: sql<ProjectRole | null>`(SELECT pm.role FROM project_members pm WHERE pm.project_id = ${projects.id} AND pm.user_id = ${taskDelegations.delegateUserId} LIMIT 1)`,
        creatorRole: sql<ProjectRole | null>`(SELECT pm.role FROM project_members pm WHERE pm.project_id = ${projects.id} AND pm.user_id = ${userId} LIMIT 1)`,
      })
      .from(taskDelegations)
      .innerJoin(delegateUser, eq(delegateUser.id, taskDelegations.delegateUserId))
      .innerJoin(tasks, eq(tasks.id, taskDelegations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(ownerUser, eq(ownerUser.id, projects.ownerId))
      .where(
        and(
          or(
            eq(taskDelegations.delegatorUserId, userId),
            and(isNull(taskDelegations.delegatorUserId), eq(projects.ownerId, userId)),
          ),
          inArray(taskDelegations.status, [...ACTIVE_STATUSES]),
        ),
      );

    return rows.map((r) => ({
      taskId: r.taskId,
      delegation: toDomain(r),
      projectId: r.projectId,
      projectName: r.projectName,
      isInbox: Boolean(r.isInbox),
      delegateRole: r.delegateRole ?? null,
      creatorRole: r.creatorRole ?? null,
    }));
  }
}
