import type {
  PendingDelegation,
  TaskDelegationRepository,
} from '@/application/task/TaskDelegationRepository';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';
import type { AssignedTask } from '@/domain/task/AssignedTask';
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

  async listAssignedToMe(): Promise<AssignedTask[]> {
    const { items } = await httpClient.get<{ items: AssignedItemDto[] }>(
      '/delegations/assigned-to-me',
    );
    // Плоский список — группировку (проект/дата/дедлайн/приоритет) делает презентация.
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
