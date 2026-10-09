import type {
  CommitSyncJobRepository,
  PendingCommitSyncJob,
} from './CommitSyncJobRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
  // Исполняет ли очередь сам сервер (подписка ChatGPT, см. ServerExecutionPolicy). Тогда
  // диспетчер её не видит: job'ы заберёт серверный исполнитель.
  readonly serverHandles?: () => Promise<boolean>;
};

export type PendingCommitSyncJobList = {
  readonly jobs: PendingCommitSyncJob[];
  // Очередь исполняет сам сервер: список диспетчеру всегда пуст, и он может опрашивать её
  // реже (раньше Ralph спрашивал каждые несколько секунд и всегда получал пустой ответ).
  readonly serverOwned: boolean;
};

export class ListPendingCommitSyncJobs {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; limit?: number }): Promise<PendingCommitSyncJobList> {
    if (await this.serverHandlesQueue()) return { jobs: [], serverOwned: true };
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const jobs = await this.deps.commitSyncJobs.listPendingForDispatcher(input.userId, limit);
    return { jobs, serverOwned: false };
  }

  private async serverHandlesQueue(): Promise<boolean> {
    if (!this.deps.serverHandles) return false;
    // Не удалось выяснить — отдаём job'ы диспетчеру, как раньше: claim атомарен, дубля не будет.
    return this.deps.serverHandles().catch(() => false);
  }
}
