import type {
  TaskProperty,
  TaskPropertyOption,
  TaskPropertyType,
  TaskPropertyValue,
} from '@/domain/task/TaskProperty';

// Кастомные свойства задач (db/109). Read — участник, мутации — editor+ (гейтит сервер).
export interface TaskPropertyRepository {
  // Определения + все значения проекта одним запросом (рендер таблицы).
  list(projectId: string): Promise<{ properties: TaskProperty[]; values: TaskPropertyValue[] }>;
  create(
    projectId: string,
    input: { name: string; type: TaskPropertyType; options?: TaskPropertyOption[] },
  ): Promise<TaskProperty>;
  update(
    projectId: string,
    propertyId: string,
    patch: {
      name?: string;
      options?: TaskPropertyOption[];
      position?: number;
      type?: TaskPropertyType;
    },
  ): Promise<TaskProperty>;
  remove(projectId: string, propertyId: string): Promise<void>;
  setValue(projectId: string, taskId: string, propertyId: string, value: string): Promise<void>;
}
