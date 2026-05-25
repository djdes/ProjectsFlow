import type { RalphMode, Task, TaskStatus } from '../../domain/task/Task.js';

export type CreateTaskInput = {
  readonly id: string;
  readonly projectId: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly position: number;
  // Режим работы Ralph (default 'normal'). См. domain RalphMode.
  readonly ralphMode?: RalphMode;
};

export type UpdateTaskPatch = {
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly position?: number;
  readonly ralphMode?: RalphMode;
};

export interface TaskRepository {
  listByProject(projectId: string): Promise<Task[]>;
  getById(taskId: string): Promise<Task | null>;
  create(input: CreateTaskInput): Promise<Task>;
  update(taskId: string, patch: UpdateTaskPatch): Promise<Task | null>;
  delete(taskId: string): Promise<boolean>;
  // Возвращает min/max позицию в колонке — для расчёта новой position при insert "сверху" / "снизу".
  getPositionBounds(projectId: string, status: TaskStatus): Promise<{ min: number; max: number } | null>;
  /**
   * Sticky-флаг «отдано агенту». В Plan A ставится транзакционно через
   * AgentJobRepository.createForDelegation. Этот метод оставлен для будущего
   * re-queue flow в Plan B (при failed → автоматически снова в очередь).
   */
  setDelegatedToAgent(taskId: string, value: boolean): Promise<void>;
}
