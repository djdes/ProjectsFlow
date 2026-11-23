import type { AssignedTask } from './AssignedTask';
import type { AwaitingReplyTask } from './AwaitingReplyTask';

// «Входящие» целиком: всё, что блок ответственных показывает на первом экране, одним чтением.
export type InboxOverview = {
  readonly mine: AssignedTask[];
  readonly others: AssignedTask[];
  readonly personal: AssignedTask[];
  readonly approvals: AssignedTask[];
  readonly awaitingReply: AwaitingReplyTask[];
};
