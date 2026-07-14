// Единственный текущий ответственный задачи. Создатель задачи хранится отдельно в
// Task.createdBy только для аудита/метеринга и не является второй стороной назначения.
// Mirrors client/src/domain/task/TaskAssignee.ts.
export type TaskAssignee = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};
