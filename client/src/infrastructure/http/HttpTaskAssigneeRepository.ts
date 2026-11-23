import type { TaskAssigneeRepository } from '@/application/task/TaskAssigneeRepository';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { AwaitingReplyTask } from '@/domain/task/AwaitingReplyTask';
import type { InboxOverview } from '@/domain/task/InboxOverview';
import { memoByAnswer } from './answerMemo';
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

type OverviewDto = {
  mine: { items: AssignedItemDto[] };
  others: { items: AssignedItemDto[] };
  personal: { items: AssignedItemDto[] };
  approvals: { items: AssignedItemDto[] };
  awaitingReply: { items: AwaitingReplyItemDto[] };
};

// The overview carries the answers of these separate reads; fresh network answers fill their
// cache entries too, so the badges that read them separately need no request.
const OVERVIEW_PARTS = {
  mine: '/assignees/mine',
  others: '/assignees/others',
  personal: '/assignees/personal',
  approvals: '/assignees/approvals',
  awaitingReply: '/assignees/awaiting-reply',
} as const;

function fromAwaitingReplyDto(item: AwaitingReplyItemDto): AwaitingReplyTask {
  return {
    ...fromAssignedDto(item),
    question: { ...item.question, askedAt: new Date(item.question.askedAt) },
  };
}

function overviewFromDto(dto: OverviewDto): InboxOverview {
  return {
    mine: dto.mine.items.map(fromAssignedDto),
    others: dto.others.items.map(fromAssignedDto),
    personal: dto.personal.items.map(fromAssignedDto),
    approvals: dto.approvals.items.map(fromAssignedDto),
    awaitingReply: dto.awaitingReply.items.map(fromAwaitingReplyDto),
  };
}

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
  // Unchanged answers give the same objects (see memoByAnswer): re-reading them after a
  // navigation or a refresh signal does not re-render the inbox and the cards.
  private readonly overviewOf = memoByAnswer(overviewFromDto);
  private readonly awaitingReplyOf = memoByAnswer((dto: { items: AwaitingReplyItemDto[] }) => dto.items.map(fromAwaitingReplyDto));

  constructor(private readonly client: typeof httpClient = httpClient) {}

  async listMineInWorkspace(workspaceId: string): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/assignees/mine', workspaceId);
  }

  async listOthersInWorkspace(workspaceId: string): Promise<AssignedTask[]> {
    return this.fetchAssignedList('/assignees/others', workspaceId);
  }

  async listMemberTasks(memberId: string): Promise<AssignedTask[]> {
    return this.fetchAssignedList(`/assignees/member/${encodeURIComponent(memberId)}`);
  }

  async listAwaitingReply(): Promise<AwaitingReplyTask[]> {
    return this.awaitingReplyOf(await this.client.read<{ items: AwaitingReplyItemDto[] }>('/assignees/awaiting-reply'));
  }

  async loadInboxOverview(options?: { readonly latest?: boolean }): Promise<InboxOverview> {
    const answer = await this.client.read<OverviewDto>('/assignees/overview', { swr: !options?.latest, parts: OVERVIEW_PARTS });
    return this.overviewOf(answer);
  }

  peekInboxOverview(): InboxOverview | null {
    const answer = this.client.peekAnswer<OverviewDto>('/assignees/overview');
    return answer ? this.overviewOf(answer) : null;
  }

  private async fetchAssignedList(path: string, workspaceId?: string): Promise<AssignedTask[]> {
    const { items } = await this.client.get<{ items: AssignedItemDto[] }>(
      path,
      workspaceId ? { workspaceId } : undefined,
    );
    return items.map(fromAssignedDto);
  }
}
