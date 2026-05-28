import type {
  ProjectMemberRepository,
  SharedUser,
} from './ProjectMemberRepository.js';

// Список user'ов, с которыми caller состоит в общих проектах — для дропдауна
// «делегировать» во входящих. Без caller'а самого.
export class ListSharedMembers {
  constructor(private readonly members: ProjectMemberRepository) {}

  async execute(userId: string): Promise<SharedUser[]> {
    return this.members.listSharedUsers(userId);
  }
}
