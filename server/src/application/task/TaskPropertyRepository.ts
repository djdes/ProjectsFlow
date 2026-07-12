import type {
  TaskProperty,
  TaskPropertyOption,
  TaskPropertyType,
  TaskPropertyValue,
} from '../../domain/task/TaskProperty.js';

export type CreateTaskPropertyInput = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: TaskPropertyType;
  readonly options: TaskPropertyOption[];
};

export type UpdateTaskPropertyPatch = {
  readonly name?: string;
  readonly options?: TaskPropertyOption[];
};

// Кастомные свойства задач (db/109). Гейты доступа — в роутах (паттерн board_views):
// чтение — участник проекта, мутации — editor+.
export interface TaskPropertyRepository {
  listForProject(projectId: string): Promise<TaskProperty[]>;
  getById(id: string): Promise<TaskProperty | null>;
  create(input: CreateTaskPropertyInput): Promise<TaskProperty>;
  update(id: string, patch: UpdateTaskPropertyPatch): Promise<TaskProperty | null>;
  delete(id: string): Promise<void>;
  // Значения: все по проекту (для рендера таблицы одним запросом) + upsert.
  listValuesForProject(projectId: string): Promise<TaskPropertyValue[]>;
  setValue(taskId: string, propertyId: string, value: string): Promise<void>;
}
