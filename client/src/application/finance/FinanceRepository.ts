import type { Employee, ProjectFinance } from '@/domain/finance/types';

export type EmployeeInput = {
  readonly name: string;
  readonly monthlySalaryKopecks: number;
};

export type EmployeePatch = {
  readonly name?: string;
  readonly monthlySalaryKopecks?: number;
  readonly active?: boolean;
};

export type AssignInput = {
  readonly employeeId: string;
  readonly allocationPercent: number;
  readonly startedAt?: string; // ISO date
  readonly endedAt?: string | null;
};

export type ExpenseInput = {
  readonly amountKopecks: number;
  readonly category: string;
  readonly description: string | null;
  readonly incurredOn: string; // ISO date
};

export type IncomeInput = {
  readonly amountKopecks: number;
  readonly source: string | null;
  readonly receivedOn: string; // ISO date
};

// Личный ростер сотрудников аккаунта.
export interface EmployeeRepository {
  list(): Promise<Employee[]>;
  create(input: EmployeeInput): Promise<Employee>;
  update(id: string, patch: EmployeePatch): Promise<Employee>;
  archive(id: string): Promise<void>;
}

// Финансы конкретного проекта (P&L + управление).
export interface ProjectFinanceRepository {
  getSummary(projectId: string): Promise<ProjectFinance>;
  assign(projectId: string, input: AssignInput): Promise<void>;
  updateAssignment(
    projectId: string,
    assignmentId: string,
    patch: { allocationPercent?: number; startedAt?: string; endedAt?: string | null },
  ): Promise<void>;
  removeAssignment(projectId: string, assignmentId: string): Promise<void>;
  addExpense(projectId: string, input: ExpenseInput): Promise<void>;
  deleteExpense(projectId: string, id: string): Promise<void>;
  addIncome(projectId: string, input: IncomeInput): Promise<void>;
  deleteIncome(projectId: string, id: string): Promise<void>;
  setVisibility(projectId: string, visibility: 'owner' | 'members'): Promise<void>;
}
