import type {
  LaborLine,
  ProjectExpense,
  ProjectFinance,
  ProjectIncome,
} from '@/domain/finance/types';
import type {
  AssignInput,
  ExpenseInput,
  IncomeInput,
  ProjectFinanceRepository,
} from '@/application/finance/FinanceRepository';
import { httpClient } from './httpClient';

type FinanceDto = {
  laborTotalKopecks: number;
  labor: Array<{
    assignmentId: string;
    employeeId: string;
    employeeName: string;
    monthlySalaryKopecks: number;
    allocationPercent: number;
    startedAt: string;
    endedAt: string | null;
    costKopecks: number;
  }>;
  otherExpensesTotalKopecks: number;
  expenses: Array<{
    id: string;
    projectId: string;
    amountKopecks: number;
    category: string;
    description: string | null;
    incurredOn: string;
  }>;
  incomeTotalKopecks: number;
  incomes: Array<{
    id: string;
    projectId: string;
    amountKopecks: number;
    source: string | null;
    receivedOn: string;
  }>;
  expenseTotalKopecks: number;
  profitKopecks: number;
  marginPercent: number | null;
};

function fromDto(dto: FinanceDto): ProjectFinance {
  const labor: LaborLine[] = dto.labor.map((l) => ({
    assignmentId: l.assignmentId,
    employeeId: l.employeeId,
    employeeName: l.employeeName,
    monthlySalaryKopecks: l.monthlySalaryKopecks,
    allocationPercent: l.allocationPercent,
    startedAt: new Date(l.startedAt),
    endedAt: l.endedAt ? new Date(l.endedAt) : null,
    costKopecks: l.costKopecks,
  }));
  const expenses: ProjectExpense[] = dto.expenses.map((e) => ({
    id: e.id,
    projectId: e.projectId,
    amountKopecks: e.amountKopecks,
    category: e.category,
    description: e.description,
    incurredOn: new Date(e.incurredOn),
  }));
  const incomes: ProjectIncome[] = dto.incomes.map((i) => ({
    id: i.id,
    projectId: i.projectId,
    amountKopecks: i.amountKopecks,
    source: i.source,
    receivedOn: new Date(i.receivedOn),
  }));
  return {
    laborTotalKopecks: dto.laborTotalKopecks,
    labor,
    otherExpensesTotalKopecks: dto.otherExpensesTotalKopecks,
    expenses,
    incomeTotalKopecks: dto.incomeTotalKopecks,
    incomes,
    expenseTotalKopecks: dto.expenseTotalKopecks,
    profitKopecks: dto.profitKopecks,
    marginPercent: dto.marginPercent,
  };
}

export class HttpProjectFinanceRepository implements ProjectFinanceRepository {
  async getSummary(projectId: string): Promise<ProjectFinance> {
    const { finance } = await httpClient.get<{ finance: FinanceDto }>(
      `/projects/${projectId}/finance/summary`,
    );
    return fromDto(finance);
  }

  async assign(projectId: string, input: AssignInput): Promise<void> {
    await httpClient.post<unknown>(`/projects/${projectId}/finance/assignments`, input);
  }

  async updateAssignment(
    projectId: string,
    assignmentId: string,
    patch: { allocationPercent?: number; startedAt?: string; endedAt?: string | null },
  ): Promise<void> {
    await httpClient.patch<unknown>(
      `/projects/${projectId}/finance/assignments/${assignmentId}`,
      patch,
    );
  }

  async removeAssignment(projectId: string, assignmentId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/finance/assignments/${assignmentId}`);
  }

  async addExpense(projectId: string, input: ExpenseInput): Promise<void> {
    await httpClient.post<unknown>(`/projects/${projectId}/finance/expenses`, input);
  }

  async deleteExpense(projectId: string, id: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/finance/expenses/${id}`);
  }

  async addIncome(projectId: string, input: IncomeInput): Promise<void> {
    await httpClient.post<unknown>(`/projects/${projectId}/finance/incomes`, input);
  }

  async deleteIncome(projectId: string, id: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/finance/incomes/${id}`);
  }

  async setVisibility(projectId: string, visibility: 'owner' | 'members'): Promise<void> {
    await httpClient.put<unknown>(`/projects/${projectId}/finance/visibility`, { visibility });
  }
}
