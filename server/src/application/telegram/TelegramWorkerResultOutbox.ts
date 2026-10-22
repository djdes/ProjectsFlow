export type WorkerCompletion = { readonly key: string; readonly startedAt: Date };
export type WorkerResultDestination = {
  readonly taskId: string;
  readonly projectId: string;
  readonly chatId: number;
  readonly messageId: number | null;
  readonly source: 'origin' | 'project' | 'workspace';
};
export type WorkerResultDelivery = WorkerResultDestination & {
  readonly id: string;
  readonly completionKey: string;
  readonly requestedAt: Date;
};
export interface TelegramWorkerResultOutbox {
  findCompletion(taskId: string, projectId: string): Promise<WorkerCompletion | null>;
  listRecoverable(now: Date, limit: number): Promise<string[]>;
  enqueue(delivery: WorkerResultDelivery): Promise<void>;
  listDue(now: Date, limit: number): Promise<WorkerResultDelivery[]>;
  claim(id: string, token: string, now: Date, until: Date): Promise<boolean>;
  finish(id: string, token: string, now: Date): Promise<void>;
  retry(id: string, token: string, at: Date): Promise<void>;
}
