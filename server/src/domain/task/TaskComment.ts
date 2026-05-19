export type TaskComment = {
  readonly id: string;
  readonly taskId: string;
  readonly ownerUserId: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
