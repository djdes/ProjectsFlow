import type {
  PendingDelegation,
  TaskDelegationRepository,
} from '@/application/task/TaskDelegationRepository';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';
import { httpClient } from './httpClient';

type DelegationDto = Omit<TaskDelegation, 'createdAt' | 'respondedAt'> & {
  createdAt: string;
  respondedAt: string | null;
};

type PendingDto = DelegationDto & { taskExcerpt: string };

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
