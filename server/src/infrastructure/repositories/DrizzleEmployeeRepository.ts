import { asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { employees, type EmployeeRow } from '../db/schema.js';
import type { Employee } from '../../domain/finance/types.js';
import type {
  CreateEmployeeInput,
  EmployeeRepository,
  UpdateEmployeeInput,
} from '../../application/finance/EmployeeRepository.js';

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    monthlySalaryKopecks: row.monthlySalaryKopecks,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export class DrizzleEmployeeRepository implements EmployeeRepository {
  constructor(private readonly db: Database) {}

  async listByOwner(ownerUserId: string): Promise<Employee[]> {
    const rows = await this.db
      .select()
      .from(employees)
      .where(eq(employees.ownerUserId, ownerUserId))
      .orderBy(asc(employees.createdAt));
    return rows.map(toEmployee);
  }

  async getById(id: string): Promise<Employee | null> {
    const rows = await this.db.select().from(employees).where(eq(employees.id, id)).limit(1);
    return rows[0] ? toEmployee(rows[0]) : null;
  }

  async getManyByIds(ids: string[]): Promise<Employee[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(employees).where(inArray(employees.id, ids));
    return rows.map(toEmployee);
  }

  async create(input: CreateEmployeeInput): Promise<Employee> {
    await this.db.insert(employees).values({
      id: input.id,
      ownerUserId: input.ownerUserId,
      name: input.name,
      monthlySalaryKopecks: input.monthlySalaryKopecks,
    });
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back employee after insert');
    return fresh;
  }

  async update(id: string, patch: UpdateEmployeeInput): Promise<Employee | null> {
    const set: Partial<Pick<EmployeeRow, 'name' | 'monthlySalaryKopecks' | 'active'>> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.monthlySalaryKopecks !== undefined) set.monthlySalaryKopecks = patch.monthlySalaryKopecks;
    if (patch.active !== undefined) set.active = patch.active;
    if (Object.keys(set).length > 0) {
      await this.db.update(employees).set(set).where(eq(employees.id, id));
    }
    return this.getById(id);
  }
}
