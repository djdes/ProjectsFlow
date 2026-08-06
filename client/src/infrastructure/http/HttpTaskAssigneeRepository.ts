import type { TaskAssigneeRepository } from '@/application/task/TaskAssigneeRepository';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import { httpClient } from './httpClient';
import { fromDto as taskFromDto, type TaskDto } from './HttpTaskRepository';

type AssignedItemDto = {
  task: TaskDto;
  projectId: string;
  projectName: string;
  isInbox: boolean;
  canModify: boolean;
  // Владелец личных входящих, где лежит задача (null у именованных проектов).
  inboxOwner?: { userId: string; displayName: string } | null;
};

export class HttpTaskAssigneeRepository implements TaskAssigneeRepository {
  async listMine(): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/assignees/mine');
  }

  async listOthers(): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/assignees/others');
  }

  async listColleaguesPersonal(): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/assignees/personal');
  }

  async listMemberTasks(memberId: string): Promise<AssignedTask[]> {
    return this.fetchAssignedList(`/assignees/member/${encodeURIComponent(memberId)}`);
  }

  private async fetchAssignedList(path: string): Promise<AssignedTask[]> {
    const { items } = await httpClient.get<{ items: AssignedItemDto[] }>(path);
    return items.map((item) => ({
      ...taskFromDto(item.task),
      projectId: item.projectId,
      projectName: item.projectName,
      isInbox: item.isInbox,
      canModify: item.canModify,
      inboxOwner: item.inboxOwner ?? null,
    }));
  }
}
