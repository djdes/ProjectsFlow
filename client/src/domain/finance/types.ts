// Финансы проекта (клиентское зеркало server/src/domain/finance). Деньги — копейки.

export type Employee = {
  readonly id: string;
  readonly name: string;
  readonly monthlySalaryKopecks: number;
  readonly active: boolean;
  readonly createdAt: Date;
};

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

export type ProjectExpense = {
  readonly id: string;
  readonly projectId: string;
  readonly amountKopecks: number;
  readonly category: string;
  readonly description: string | null;
  readonly incurredOn: Date;
};

export type ProjectIncome = {
  readonly id: string;
  readonly projectId: string;
  readonly amountKopecks: number;
  readonly source: string | null;
  readonly receivedOn: Date;
};

export type ProjectFinance = {
  readonly laborTotalKopecks: number;
  readonly labor: readonly LaborLine[];
  readonly otherExpensesTotalKopecks: number;
  readonly expenses: readonly ProjectExpense[];
  readonly incomeTotalKopecks: number;
  readonly incomes: readonly ProjectIncome[];
  readonly expenseTotalKopecks: number;
  readonly profitKopecks: number;
  readonly marginPercent: number | null;
};
