import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import {
  AssignmentNotFoundError,
  EmployeeNotFoundError,
  FinanceValidationError,
} from '../../domain/finance/errors.js';
import type { FinanceVisibility } from '../../domain/project/Project.js';
import type {
  ProjectEmployeeAssignment,
  ProjectExpense,
  ProjectIncome,
} from '../../domain/finance/types.js';
import type { EmployeeRepository } from './EmployeeRepository.js';
import type { ProjectFinanceRepository } from './ProjectFinanceRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly employees: EmployeeRepository;
  readonly finance: ProjectFinanceRepository;
  readonly idGen: () => string;
  readonly now: () => Date;
};

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function validateAmount(kopecks: number): number {
  if (!Number.isInteger(kopecks) || kopecks < 0) {
    throw new FinanceValidationError('Сумма должна быть неотрицательным числом');
  }
  return kopecks;
}

function validateAllocation(percent: number): number {
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new FinanceValidationError('Доля занятости — целое от 1 до 100');
  }
  return percent;
}

// Все мутации финансов гейтятся manage_finance (owner / admin-bypass).
export class ManageProjectFinance {
  constructor(private readonly deps: Deps) {}

  private access(projectId: string, actorUserId: string) {
    return requireProjectAccess(this.deps, projectId, actorUserId, 'manage_finance');
  }

  // --- Assignments ---
  async assign(
    projectId: string,
    actorUserId: string,
    input: { employeeId: string; allocationPercent: number; startedAt?: Date; endedAt?: Date | null },
  ): Promise<ProjectEmployeeAssignment> {
    const { project } = await this.access(projectId, actorUserId);
    const emp = await this.deps.employees.getById(input.employeeId);
    if (!emp || emp.ownerUserId !== actorUserId) throw new EmployeeNotFoundError();

    const startedAt = toDateOnly(input.startedAt ?? project.createdAt);
    const endedAt = input.endedAt ? toDateOnly(input.endedAt) : null;
    if (endedAt && endedAt < startedAt) {
      throw new FinanceValidationError('Дата окончания раньше даты начала');
    }
    return this.deps.finance.upsertAssignment({
      id: this.deps.idGen(),
      projectId,
      employeeId: input.employeeId,
      allocationPercent: validateAllocation(input.allocationPercent),
      startedAt,
      endedAt,
    });
  }

  async updateAssignment(
    projectId: string,
    actorUserId: string,
    assignmentId: string,
    patch: { allocationPercent?: number; startedAt?: Date; endedAt?: Date | null },
  ): Promise<ProjectEmployeeAssignment> {
    await this.access(projectId, actorUserId);
    const existing = await this.deps.finance.getAssignment(assignmentId);
    if (!existing || existing.projectId !== projectId) throw new AssignmentNotFoundError();
    const startedAt = patch.startedAt ? toDateOnly(patch.startedAt) : existing.startedAt;
    const endedAt =
      patch.endedAt === undefined ? existing.endedAt : patch.endedAt ? toDateOnly(patch.endedAt) : null;
    if (endedAt && endedAt < startedAt) {
      throw new FinanceValidationError('Дата окончания раньше даты начала');
    }
    const updated = await this.deps.finance.updateAssignment(assignmentId, {
      allocationPercent:
        patch.allocationPercent !== undefined ? validateAllocation(patch.allocationPercent) : undefined,
      startedAt,
      endedAt,
    });
    if (!updated) throw new AssignmentNotFoundError();
    return updated;
  }

  async removeAssignment(projectId: string, actorUserId: string, assignmentId: string): Promise<void> {
    await this.access(projectId, actorUserId);
    const existing = await this.deps.finance.getAssignment(assignmentId);
    if (!existing || existing.projectId !== projectId) throw new AssignmentNotFoundError();
    await this.deps.finance.removeAssignment(assignmentId);
  }

  // --- Expenses ---
  async addExpense(
    projectId: string,
    actorUserId: string,
    input: { amountKopecks: number; category: string; description: string | null; incurredOn: Date },
  ): Promise<ProjectExpense> {
    await this.access(projectId, actorUserId);
    return this.deps.finance.createExpense({
      id: this.deps.idGen(),
      projectId,
      amountKopecks: validateAmount(input.amountKopecks),
      category: input.category.trim() || 'other',
      description: input.description?.trim() || null,
      incurredOn: toDateOnly(input.incurredOn),
      createdBy: actorUserId,
    });
  }

  async deleteExpense(projectId: string, actorUserId: string, id: string): Promise<void> {
    await this.access(projectId, actorUserId);
    await this.deps.finance.deleteExpense(projectId, id);
  }

  // --- Incomes ---
  async addIncome(
    projectId: string,
    actorUserId: string,
    input: { amountKopecks: number; source: string | null; receivedOn: Date },
  ): Promise<ProjectIncome> {
    await this.access(projectId, actorUserId);
    return this.deps.finance.createIncome({
      id: this.deps.idGen(),
      projectId,
      amountKopecks: validateAmount(input.amountKopecks),
      source: input.source?.trim() || null,
      receivedOn: toDateOnly(input.receivedOn),
      createdBy: actorUserId,
    });
  }

  async deleteIncome(projectId: string, actorUserId: string, id: string): Promise<void> {
    await this.access(projectId, actorUserId);
    await this.deps.finance.deleteIncome(projectId, id);
  }

  // --- Visibility ---
  async setVisibility(
    projectId: string,
    actorUserId: string,
    visibility: FinanceVisibility,
  ): Promise<void> {
    await this.access(projectId, actorUserId);
    await this.deps.projects.update(projectId, { financeVisibility: visibility });
  }
}
