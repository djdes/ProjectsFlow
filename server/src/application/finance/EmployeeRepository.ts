import type { Employee } from '../../domain/finance/types.js';

export type CreateEmployeeInput = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly monthlySalaryKopecks: number;
};

export type UpdateEmployeeInput = {
  readonly name?: string;
  readonly monthlySalaryKopecks?: number;
  readonly active?: boolean;
};

export interface EmployeeRepository {
  listByOwner(ownerUserId: string): Promise<Employee[]>;
  getById(id: string): Promise<Employee | null>;
  getManyByIds(ids: string[]): Promise<Employee[]>;
  create(input: CreateEmployeeInput): Promise<Employee>;
  update(id: string, patch: UpdateEmployeeInput): Promise<Employee | null>;
}
