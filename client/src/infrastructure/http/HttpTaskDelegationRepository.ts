import type { TaskDelegationRepository } from '@/application/task/TaskDelegationRepository';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import { httpClient } from './httpClient';
import { fromDto as taskFromDto, type TaskDto } from './HttpTaskRepository';

type AssignedItemDto = {
  task: TaskDto;
  projectId: string;
  projectName: string;
  isInbox: boolean;
  canModify: boolean;
};

export class HttpTaskDelegationRepository implements TaskDelegationRepository {
  async listAssignedToMe(): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/delegations/assigned-to-me');
  }

  async listDelegatedToOthers(): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/delegations/delegated-to-others');
  }

  // Общий фетчер assigned-to-me / delegated-to-others — сервер отдаёт одинаковый view-shape.
  private async fetchAssignedList(path: string): Promise<AssignedTask[]> {
    const { items } = await httpClient.get<{ items: AssignedItemDto[] }>(path);
    const out: AssignedTask[] = [];
    for (const it of items) {
      const task = taskFromDto(it.task);
      if (!task.delegation) continue; // сервер гарантирует наличие; страхуемся
      out.push({
        ...task,
        delegation: task.delegation,
        projectId: it.projectId,
        projectName: it.projectName,
        isInbox: it.isInbox,
        canModify: it.canModify,
      });
    }
    return out;
  }

  async withdraw(id: string): Promise<void> {
    await httpClient.delete<void>(`/delegations/${id}`);
  }

  async relinquish(id: string): Promise<void> {
    await httpClient.post<void>(`/delegations/${id}/relinquish`, {});
  }
}
