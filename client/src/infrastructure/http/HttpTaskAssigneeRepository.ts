import type { TaskAssigneeRepository } from '@/application/task/TaskAssigneeRepository';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { AwaitingReplyTask } from '@/domain/task/AwaitingReplyTask';
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

type AwaitingReplyItemDto = AssignedItemDto & {
  question: {
    commentId: string;
    authorUserId: string;
    authorDisplayName: string;
    excerpt: string;
    askedAt: string;
  };
};

function fromAssignedDto(item: AssignedItemDto): AssignedTask {
  return {
    ...taskFromDto(item.task),
    projectId: item.projectId,
    projectName: item.projectName,
    isInbox: item.isInbox,
    canModify: item.canModify,
    inboxOwner: item.inboxOwner ?? null,
  };
}

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

  async listApprovalQueue(): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/assignees/approvals');
  }

  async listAwaitingReply(): Promise<AwaitingReplyTask[]> {
    const { items } = await httpClient.get<{ items: AwaitingReplyItemDto[] }>('/assignees/awaiting-reply');
    return items.map((item) => ({
      ...fromAssignedDto(item),
      question: { ...item.question, askedAt: new Date(item.question.askedAt) },
    }));
  }

  private async fetchAssignedList(path: string): Promise<AssignedTask[]> {
    const { items } = await httpClient.get<{ items: AssignedItemDto[] }>(path);
    return items.map(fromAssignedDto);
  }
}
