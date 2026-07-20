import type { AssignedTask } from '@/domain/task/AssignedTask';

export interface TaskAssigneeRepository {
  // Все задачи, где caller — текущий обязательный ответственный.
  listMine(): Promise<AssignedTask[]>;
  // Все видимые caller'у задачи, где отвечает другой участник.
  listOthers(): Promise<AssignedTask[]>;
  // Личные (inbox) задачи коллег — тех, с кем есть общее рабочее пространство.
  // Только чтение: canModify у таких задач всегда false.
  listColleaguesPersonal(): Promise<AssignedTask[]>;
}
