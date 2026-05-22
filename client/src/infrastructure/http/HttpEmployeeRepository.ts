import type { Employee } from '@/domain/finance/types';
import type {
  EmployeeInput,
  EmployeePatch,
  EmployeeRepository,
} from '@/application/finance/FinanceRepository';
import { httpClient } from './httpClient';

type EmployeeDto = {
  id: string;
  name: string;
  monthlySalaryKopecks: number;
  active: boolean;
  createdAt: string;
};

function fromDto(dto: EmployeeDto): Employee {
  return {
    id: dto.id,
    name: dto.name,
    monthlySalaryKopecks: dto.monthlySalaryKopecks,
    active: dto.active,
    createdAt: new Date(dto.createdAt),
  };
}

export class HttpEmployeeRepository implements EmployeeRepository {
  async list(): Promise<Employee[]> {
    const { employees } = await httpClient.get<{ employees: EmployeeDto[] }>('/employees');
    return employees.map(fromDto);
  }

  async create(input: EmployeeInput): Promise<Employee> {
    const { employee } = await httpClient.post<{ employee: EmployeeDto }>('/employees', input);
    return fromDto(employee);
  }

  async update(id: string, patch: EmployeePatch): Promise<Employee> {
    const { employee } = await httpClient.patch<{ employee: EmployeeDto }>(`/employees/${id}`, patch);
    return fromDto(employee);
  }

  async archive(id: string): Promise<void> {
    await httpClient.delete<void>(`/employees/${id}`);
  }
}
