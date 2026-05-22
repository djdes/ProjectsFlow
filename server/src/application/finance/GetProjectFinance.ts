import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { LaborLine, ProjectFinance } from '../../domain/finance/types.js';
import type { EmployeeRepository } from './EmployeeRepository.js';
import type { ProjectFinanceRepository } from './ProjectFinanceRepository.js';
import { laborCostKopecks } from './laborCost.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly employees: EmployeeRepository;
  readonly finance: ProjectFinanceRepository;
  readonly now: () => Date;
};

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export class GetProjectFinance {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<ProjectFinance> {
    // Член проекта (или admin через bypass) — иначе 404.
    const { project, membership } = await requireProjectAccess(
      this.deps,
      projectId,
      userId,
      'read_project',
    );
    // Видимость финансов: не-владелец видит только если включён режим 'members'.
    if (membership.role !== 'owner' && project.financeVisibility !== 'members') {
      throw new InsufficientProjectRoleError(membership.role, 'manage_finance');
    }

    const today = toDateOnly(this.deps.now());
    const assignments = await this.deps.finance.listAssignments(projectId);
    const empIds = [...new Set(assignments.map((a) => a.employeeId))];
    const empMap = new Map(
      (await this.deps.employees.getManyByIds(empIds)).map((e) => [e.id, e]),
    );

    const labor: LaborLine[] = [];
    let laborTotalKopecks = 0;
    for (const a of assignments) {
      const emp = empMap.get(a.employeeId);
      if (!emp) continue; // сотрудник удалён — пропускаем
      const end = a.endedAt && a.endedAt < today ? a.endedAt : today;
      const costKopecks = laborCostKopecks(
        emp.monthlySalaryKopecks,
        a.allocationPercent,
        a.startedAt,
        end,
      );
      laborTotalKopecks += costKopecks;
      labor.push({
        assignmentId: a.id,
        employeeId: emp.id,
        employeeName: emp.name,
        monthlySalaryKopecks: emp.monthlySalaryKopecks,
        allocationPercent: a.allocationPercent,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        costKopecks,
      });
    }

    const expenses = await this.deps.finance.listExpenses(projectId);
    const otherExpensesTotalKopecks = expenses.reduce((s, e) => s + e.amountKopecks, 0);
    const incomes = await this.deps.finance.listIncomes(projectId);
    const incomeTotalKopecks = incomes.reduce((s, i) => s + i.amountKopecks, 0);

    const expenseTotalKopecks = laborTotalKopecks + otherExpensesTotalKopecks;
    const profitKopecks = incomeTotalKopecks - expenseTotalKopecks;
    const marginPercent =
      incomeTotalKopecks > 0
        ? Math.round((profitKopecks / incomeTotalKopecks) * 10000) / 100
        : null;

    return {
      laborTotalKopecks,
      labor,
      otherExpensesTotalKopecks,
      expenses,
      incomeTotalKopecks,
      incomes,
      expenseTotalKopecks,
      profitKopecks,
      marginPercent,
    };
  }
}
