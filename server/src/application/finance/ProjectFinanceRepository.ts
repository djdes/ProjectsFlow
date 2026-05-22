import type {
  ProjectEmployeeAssignment,
  ProjectExpense,
  ProjectIncome,
} from '../../domain/finance/types.js';

export type UpsertAssignmentInput = {
  readonly id: string;
  readonly projectId: string;
  readonly employeeId: string;
  readonly allocationPercent: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
};

export type CreateExpenseInput = {
  readonly id: string;
  readonly projectId: string;
  readonly amountKopecks: number;
  readonly category: string;
  readonly description: string | null;
  readonly incurredOn: Date;
  readonly createdBy: string;
};

export type CreateIncomeInput = {
  readonly id: string;
  readonly projectId: string;
  readonly amountKopecks: number;
  readonly source: string | null;
  readonly receivedOn: Date;
  readonly createdBy: string;
};

export interface ProjectFinanceRepository {
  // Assignments
  listAssignments(projectId: string): Promise<ProjectEmployeeAssignment[]>;
  listAssignmentsForEmployee(employeeId: string): Promise<ProjectEmployeeAssignment[]>;
  getAssignment(id: string): Promise<ProjectEmployeeAssignment | null>;
  upsertAssignment(input: UpsertAssignmentInput): Promise<ProjectEmployeeAssignment>;
  updateAssignment(
    id: string,
    patch: { allocationPercent?: number; startedAt?: Date; endedAt?: Date | null },
  ): Promise<ProjectEmployeeAssignment | null>;
  removeAssignment(id: string): Promise<void>;
  // Закрыть открытые назначения сотрудника (при архивации) — ended_at = today.
  endOpenAssignmentsForEmployee(employeeId: string, endedAt: Date): Promise<void>;

  // Expenses
  listExpenses(projectId: string): Promise<ProjectExpense[]>;
  createExpense(input: CreateExpenseInput): Promise<ProjectExpense>;
  deleteExpense(projectId: string, id: string): Promise<void>;

  // Incomes
  listIncomes(projectId: string): Promise<ProjectIncome[]>;
  createIncome(input: CreateIncomeInput): Promise<ProjectIncome>;
  deleteIncome(projectId: string, id: string): Promise<void>;
}
