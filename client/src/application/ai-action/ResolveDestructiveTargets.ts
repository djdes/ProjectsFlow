import type { AiAction, AiAffectedEntity } from '@/domain/ai-action/AiAction';
import { aiActionRisk } from '@/domain/ai-action/AiAction';
import type { TaskRepository } from '@/application/task/TaskRepository';

export type DestructiveTarget = { readonly action: AiAction; readonly projectId: string };

const UNTITLED_TASK = 'Без названия';

/**
 * Разворачивает разрушительные действия в конкретный список объектов ДО их исполнения —
 * карточка review обязана показать названия задач, а не идентификаторы (§2 референса).
 * Задачи проекта читаются один раз на проект: `delete_all_tasks` и несколько
 * `delete_task` в одном плане не должны дёргать список повторно.
 */
export class ResolveDestructiveTargets {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(targets: readonly DestructiveTarget[]): Promise<AiAffectedEntity[]> {
    const byProject = new Map<string, Awaited<ReturnType<TaskRepository['list']>>>();
    const loadTasks = async (projectId: string): Promise<Awaited<ReturnType<TaskRepository['list']>>> => {
      const cached = byProject.get(projectId);
      if (cached) return cached;
      const loaded = await this.tasks.list(projectId);
      byProject.set(projectId, loaded);
      return loaded;
    };

    const entities: AiAffectedEntity[] = [];
    for (const { action, projectId } of targets) {
      if (aiActionRisk(action) !== 'destructive') continue;
      const projectTasks = await loadTasks(projectId);
      if (action.type === 'delete_all_tasks') {
        for (const task of projectTasks) {
          entities.push(toEntity(action.id, projectId, task.id, task.description));
        }
        continue;
      }
      if (action.type === 'delete_task') {
        const task = projectTasks.find((item) => item.id === action.taskId);
        // Задача могла исчезнуть между планированием и review — показываем её как
        // отсутствующую, а не молча выбрасываем из списка.
        entities.push(toEntity(action.id, projectId, action.taskId, task ? task.description : null));
      }
    }
    return entities;
  }
}

function toEntity(
  actionId: string,
  projectId: string,
  entityId: string,
  description: string | null,
): AiAffectedEntity {
  const title = (description ?? '').split('\n')[0]?.trim() ?? '';
  return {
    actionId,
    kind: 'task',
    projectId,
    entityId,
    title: title || UNTITLED_TASK,
  };
}
