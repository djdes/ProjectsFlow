import type {
  DelegationWithTaskInfo,
  TaskDelegationRepository,
} from './TaskDelegationRepository.js';

// Pending делегации, в которых caller — делегат. Для верхнего блока inbox
// «Делегировано мне» с кнопками Accept/Decline.
export class ListMyPendingDelegations {
  constructor(private readonly delegations: TaskDelegationRepository) {}

  async execute(userId: string): Promise<DelegationWithTaskInfo[]> {
    return this.delegations.listPendingForDelegate(userId);
  }
}
