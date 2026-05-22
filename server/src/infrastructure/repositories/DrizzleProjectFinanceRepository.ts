import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectEmployeeAssignments,
  projectExpenses,
  projectIncomes,
  type ProjectEmployeeAssignmentRow,
  type ProjectExpenseRow,
  type ProjectIncomeRow,
} from '../db/schema.js';
import type {
  ProjectEmployeeAssignment,
  ProjectExpense,
  ProjectIncome,
} from '../../domain/finance/types.js';
import type {
  CreateExpenseInput,
  CreateIncomeInput,
  ProjectFinanceRepository,
  UpsertAssignmentInput,
} from '../../application/finance/ProjectFinanceRepository.js';

function toAssignment(r: ProjectEmployeeAssignmentRow): ProjectEmployeeAssignment {
  return {
    id: r.id,
    projectId: r.projectId,
    employeeId: r.employeeId,
    allocationPercent: r.allocationPercent,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? null,
  };
}

function toExpense(r: ProjectExpenseRow): ProjectExpense {
  return {
    id: r.id,
    projectId: r.projectId,
    amountKopecks: r.amountKopecks,
    category: r.category,
    description: r.description ?? null,
    incurredOn: r.incurredOn,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

function toIncome(r: ProjectIncomeRow): ProjectIncome {
  return {
    id: r.id,
    projectId: r.projectId,
    amountKopecks: r.amountKopecks,
    source: r.source ?? null,
    receivedOn: r.receivedOn,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export class DrizzleProjectFinanceRepository implements ProjectFinanceRepository {
  constructor(private readonly db: Database) {}

  // --- Assignments ---
  async listAssignments(projectId: string): Promise<ProjectEmployeeAssignment[]> {
    const rows = await this.db
      .select()
      .from(projectEmployeeAssignments)
      .where(eq(projectEmployeeAssignments.projectId, projectId))
      .orderBy(asc(projectEmployeeAssignments.createdAt));
    return rows.map(toAssignment);
  }

  async listAssignmentsForEmployee(employeeId: string): Promise<ProjectEmployeeAssignment[]> {
    const rows = await this.db
      .select()
      .from(projectEmployeeAssignments)
      .where(eq(projectEmployeeAssignments.employeeId, employeeId));
    return rows.map(toAssignment);
  }

  async getAssignment(id: string): Promise<ProjectEmployeeAssignment | null> {
    const rows = await this.db
      .select()
      .from(projectEmployeeAssignments)
      .where(eq(projectEmployeeAssignments.id, id))
      .limit(1);
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async upsertAssignment(input: UpsertAssignmentInput): Promise<ProjectEmployeeAssignment> {
    // UNIQUE(project_id, employee_id) — повторное назначение обновляет долю/период.
    await this.db
      .insert(projectEmployeeAssignments)
      .values({
        id: input.id,
        projectId: input.projectId,
        employeeId: input.employeeId,
        allocationPercent: input.allocationPercent,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          allocationPercent: input.allocationPercent,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
        },
      });
    const rows = await this.db
      .select()
      .from(projectEmployeeAssignments)
      .where(
        and(
          eq(projectEmployeeAssignments.projectId, input.projectId),
          eq(projectEmployeeAssignments.employeeId, input.employeeId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error('Failed to read back assignment after upsert');
    return toAssignment(rows[0]);
  }

  async updateAssignment(
    id: string,
    patch: { allocationPercent?: number; startedAt?: Date; endedAt?: Date | null },
  ): Promise<ProjectEmployeeAssignment | null> {
    const set: Partial<Pick<ProjectEmployeeAssignmentRow, 'allocationPercent' | 'startedAt' | 'endedAt'>> = {};
    if (patch.allocationPercent !== undefined) set.allocationPercent = patch.allocationPercent;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
    if (patch.endedAt !== undefined) set.endedAt = patch.endedAt;
    if (Object.keys(set).length > 0) {
      await this.db
        .update(projectEmployeeAssignments)
        .set(set)
        .where(eq(projectEmployeeAssignments.id, id));
    }
    return this.getAssignment(id);
  }

  async removeAssignment(id: string): Promise<void> {
    await this.db.delete(projectEmployeeAssignments).where(eq(projectEmployeeAssignments.id, id));
  }

  async endOpenAssignmentsForEmployee(employeeId: string, endedAt: Date): Promise<void> {
    await this.db
      .update(projectEmployeeAssignments)
      .set({ endedAt })
      .where(
        and(
          eq(projectEmployeeAssignments.employeeId, employeeId),
          isNull(projectEmployeeAssignments.endedAt),
        ),
      );
  }

  // --- Expenses ---
  async listExpenses(projectId: string): Promise<ProjectExpense[]> {
    const rows = await this.db
      .select()
      .from(projectExpenses)
      .where(eq(projectExpenses.projectId, projectId))
      .orderBy(desc(projectExpenses.incurredOn));
    return rows.map(toExpense);
  }

  async createExpense(input: CreateExpenseInput): Promise<ProjectExpense> {
    await this.db.insert(projectExpenses).values({
      id: input.id,
      projectId: input.projectId,
      amountKopecks: input.amountKopecks,
      category: input.category,
      description: input.description,
      incurredOn: input.incurredOn,
      createdBy: input.createdBy,
    });
    const rows = await this.db
      .select()
      .from(projectExpenses)
      .where(eq(projectExpenses.id, input.id))
      .limit(1);
    if (!rows[0]) throw new Error('Failed to read back expense after insert');
    return toExpense(rows[0]);
  }

  async deleteExpense(projectId: string, id: string): Promise<void> {
    await this.db
      .delete(projectExpenses)
      .where(and(eq(projectExpenses.id, id), eq(projectExpenses.projectId, projectId)));
  }

  // --- Incomes ---
  async listIncomes(projectId: string): Promise<ProjectIncome[]> {
    const rows = await this.db
      .select()
      .from(projectIncomes)
      .where(eq(projectIncomes.projectId, projectId))
      .orderBy(desc(projectIncomes.receivedOn));
    return rows.map(toIncome);
  }

  async createIncome(input: CreateIncomeInput): Promise<ProjectIncome> {
    await this.db.insert(projectIncomes).values({
      id: input.id,
      projectId: input.projectId,
      amountKopecks: input.amountKopecks,
      source: input.source,
      receivedOn: input.receivedOn,
      createdBy: input.createdBy,
    });
    const rows = await this.db
      .select()
      .from(projectIncomes)
      .where(eq(projectIncomes.id, input.id))
      .limit(1);
    if (!rows[0]) throw new Error('Failed to read back income after insert');
    return toIncome(rows[0]);
  }

  async deleteIncome(projectId: string, id: string): Promise<void> {
    await this.db
      .delete(projectIncomes)
      .where(and(eq(projectIncomes.id, id), eq(projectIncomes.projectId, projectId)));
  }
}
