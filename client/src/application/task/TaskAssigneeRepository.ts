import type { AssignedTask } from '@/domain/task/AssignedTask';

export interface TaskAssigneeRepository {
  // Все задачи, где caller — текущий обязательный ответственный.
  listMine(): Promise<AssignedTask[]>;
  // Все видимые caller'у задачи, где отвечает другой участник.
  listOthers(): Promise<AssignedTask[]>;
}
