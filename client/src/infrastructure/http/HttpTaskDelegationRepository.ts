import type {
  PendingDelegation,
  TaskDelegationRepository,
} from '@/application/task/TaskDelegationRepository';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';
import type { AssignedGroup, AssignedTask } from '@/domain/task/AssignedTask';
import { httpClient } from './httpClient';
import { fromDto as taskFromDto, type TaskDto } from './HttpTaskRepository';

type DelegationDto = Omit<TaskDelegation, 'createdAt' | 'respondedAt'> & {
  createdAt: string;
  respondedAt: string | null;
};

type PendingDto = DelegationDto & { taskExcerpt: string };

type AssignedItemDto = {
  task: TaskDto;
  projectId: string;
  projectName: string;
  isInbox: boolean;
  canModify: boolean;
};

function fromDto(dto: DelegationDto): TaskDelegation {
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    respondedAt: dto.respondedAt ? new Date(dto.respondedAt) : null,
  };
}

export class HttpTaskDelegationRepository implements TaskDelegationRepository {
  async listMyPending(): Promise<PendingDelegation[]> {
    const { delegations } = await httpClient.get<{ delegations: PendingDto[] }>(
      '/delegations/pending',
    );
    return delegations.map((d) => ({ ...fromDto(d), taskExcerpt: d.taskExcerpt }));
  }

  async listAssignedToMe(): Promise<AssignedGroup[]> {
    const { items } = await httpClient.get<{ items: AssignedItemDto[] }>(
      '/delegations/assigned-to-me',
    );
    // Группируем по проекту, сохраняя порядок первого появления.
    const groups = new Map<string, AssignedGroup>();
    for (const it of items) {
      const task = taskFromDto(it.task);
      if (!task.delegation) continue; // сервер гарантирует наличие; страхуемся
      const assigned: AssignedTask = {
        ...task,
        delegation: task.delegation,
        projectId: it.projectId,
        projectName: it.projectName,
        isInbox: it.isInbox,
        canModify: it.canModify,
      };
      let g = groups.get(it.projectId);
      if (!g) {
        // inbox — задача лежит в личном инбоксе делегатора → ярлык по его имени.
        const label = it.isInbox
          ? `Личные · ${task.delegation.creatorDisplayName}`
          : it.projectName;
        g = { projectId: it.projectId, label, isInbox: it.isInbox, items: [] };
        groups.set(it.projectId, g);
      }
      (g.items as AssignedTask[]).push(assigned);
    }
    return [...groups.values()];
  }
  async accept(id: string): Promise<TaskDelegation> {
    const { delegation } = await httpClient.post<{ delegation: DelegationDto }>(
      `/delegations/${id}/accept`,
      {},
    );
    return fromDto(delegation);
  }
  async decline(id: string): Promise<TaskDelegation> {
    const { delegation } = await httpClient.post<{ delegation: DelegationDto }>(
      `/delegations/${id}/decline`,
      {},
    );
    return fromDto(delegation);
  }
  async withdraw(id: string): Promise<void> {
    await httpClient.delete<void>(`/delegations/${id}`);
  }
}
