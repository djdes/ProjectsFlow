import type { AiActionBeforeSnapshot } from '../../domain/ai-action/AiActionBatch.js';

/**
 * Port through which the batch service reverses already-applied actions. It is a port
 * rather than a direct dependency on the task/project use-cases so that the service
 * stays testable without dragging the whole task authorization graph into its tests;
 * the composition root binds it to the very same use-cases the HTTP routes use, which
 * keeps permission checks identical between "do" and "undo".
 */
export interface AiActionUndoExecutor {
  deleteTask(projectId: string, actorUserId: string, taskId: string): Promise<void>;
  restoreTask(projectId: string, actorUserId: string, taskId: string): Promise<void>;
  updateTask(
    projectId: string,
    actorUserId: string,
    taskId: string,
    before: AiActionBeforeSnapshot,
  ): Promise<void>;
  deleteProject(projectId: string, actorUserId: string): Promise<void>;
}
