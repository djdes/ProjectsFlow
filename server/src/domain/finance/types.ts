// Финансовые сущности проекта. Все денежные значения — целые КОПЕЙКИ (без float).

export type Employee = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly monthlySalaryKopecks: number;
  readonly active: boolean;
  readonly createdAt: Date;
};

export type ProjectEmployeeAssignment = {
  readonly id: string;
  readonly projectId: string;
  readonly employeeId: string;
  readonly allocationPercent: number; // 1..100
  readonly startedAt: Date; // date-only
  readonly endedAt: Date | null; // date-only; null = ещё работает
};

export type ExpenseCategory = 'ads' | 'infra' | 'tools' | 'other';

export type ProjectExpense = {
  readonly id: string;
  readonly projectId: string;
  readonly amountKopecks: number;
  readonly category: string;
  readonly description: string | null;
  readonly incurredOn: Date; // date-only
  readonly createdBy: string;
  readonly createdAt: Date;
};

export type ProjectIncome = {
  readonly id: string;
  readonly projectId: string;
  readonly amountKopecks: number;
  readonly source: string | null;
  readonly receivedOn: Date; // date-only
  readonly createdBy: string;
  readonly createdAt: Date;
};

// Read-model: посчитанная экономика проекта (P&L).
export type LaborLine = {
  readonly assignmentId: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly monthlySalaryKopecks: number;
  readonly allocationPercent: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly costKopecks: number;
};

export type ProjectFinance = {
  readonly laborTotalKopecks: number;
  readonly labor: readonly LaborLine[];
  readonly otherExpensesTotalKopecks: number;
  readonly expenses: readonly ProjectExpense[];
  readonly incomeTotalKopecks: number;
  readonly incomes: readonly ProjectIncome[];
  readonly expenseTotalKopecks: number; // labor + other
  readonly profitKopecks: number; // income - expense
  readonly marginPercent: number | null; // profit / income * 100, null если дохода нет
};
