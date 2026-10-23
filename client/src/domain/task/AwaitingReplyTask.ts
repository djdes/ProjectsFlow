import type { AssignedTask } from './AssignedTask';

// A task where a comment was addressed to me personally (picked in «Кого уведомить» or
// @-mentioned) and I have not answered it in this task yet. `question` is the latest such
// comment. The task does not have to be mine: questions to a lead usually live in others' tasks.
export type AwaitingReplyTask = AssignedTask & {
  readonly question: {
    readonly commentId: string;
    readonly authorUserId: string;
    readonly authorDisplayName: string;
    readonly excerpt: string;
    readonly askedAt: Date;
  };
};
