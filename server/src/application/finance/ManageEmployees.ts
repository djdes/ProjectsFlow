import type { Employee } from '../../domain/finance/types.js';
import { EmployeeNotFoundError, FinanceValidationError } from '../../domain/finance/errors.js';
import type { EmployeeRepository } from './EmployeeRepository.js';
import type { ProjectFinanceRepository } from './ProjectFinanceRepository.js';

type Deps = {
  readonly employees: EmployeeRepository;
  readonly finance: ProjectFinanceRepository;
  readonly idGen: () => string;
  readonly now: () => Date;
};

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new FinanceValidationError('Введите имя сотрудника');
  if (trimmed.length > 120) throw new FinanceValidationError('Слишком длинное имя');
  return trimmed;
}

function validateSalary(kopecks: number): number {
  if (!Number.isInteger(kopecks) || kopecks < 0) {
    throw new FinanceValidationError('Оклад должен быть неотрицательным числом');
  }
  return kopecks;
}

// Управление личным ростером сотрудников аккаунта (scope = ownerUserId). Никакого
// project-access — это приватные данные владельца.
export class ManageEmployees {
  constructor(private readonly deps: Deps) {}

  list(ownerUserId: string): Promise<Employee[]> {
    return this.deps.employees.listByOwner(ownerUserId);
  }

  create(
    ownerUserId: string,
    input: { name: string; monthlySalaryKopecks: number },
  ): Promise<Employee> {
    return this.deps.employees.create({
      id: this.deps.idGen(),
      ownerUserId,
      name: validateName(input.name),
      monthlySalaryKopecks: validateSalary(input.monthlySalaryKopecks),
    });
  }

  async update(
    ownerUserId: string,
    id: string,
    patch: { name?: string; monthlySalaryKopecks?: number; active?: boolean },
  ): Promise<Employee> {
    await this.requireOwned(ownerUserId, id);
    const updated = await this.deps.employees.update(id, {
      name: patch.name !== undefined ? validateName(patch.name) : undefined,
      monthlySalaryKopecks:
        patch.monthlySalaryKopecks !== undefined
          ? validateSalary(patch.monthlySalaryKopecks)
          : undefined,
      active: patch.active,
    });
    if (!updated) throw new EmployeeNotFoundError();
    return updated;
  }

  // Архивация: active=false + закрываем открытые назначения сегодняшней датой
  // (прошлые трудозатраты сохраняются, будущие — не начисляются).
  async archive(ownerUserId: string, id: string): Promise<void> {
    await this.requireOwned(ownerUserId, id);
    await this.deps.employees.update(id, { active: false });
    await this.deps.finance.endOpenAssignmentsForEmployee(id, this.deps.now());
  }

  private async requireOwned(ownerUserId: string, id: string): Promise<Employee> {
    const emp = await this.deps.employees.getById(id);
    if (!emp || emp.ownerUserId !== ownerUserId) throw new EmployeeNotFoundError();
    return emp;
  }
}
