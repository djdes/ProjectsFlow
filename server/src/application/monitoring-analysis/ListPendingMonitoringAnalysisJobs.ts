import type {
  MonitoringAnalysisJobRepository,
  PendingMonitoringAnalysisJob,
} from './MonitoringAnalysisJobRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type Deps = {
  readonly monitoringAnalysisJobs: MonitoringAnalysisJobRepository;
  // Исполняет ли очередь сам сервер (подписка ChatGPT, см. ServerExecutionPolicy) — тогда
  // диспетчер её job'ы не видит. Не задано — прежнее поведение.
  readonly serverHandles?: () => Promise<boolean>;
};

export type PendingMonitoringAnalysisJobList = {
  readonly jobs: PendingMonitoringAnalysisJob[];
  // Очередь исполняет сам сервер: список диспетчеру всегда пуст, и он может опрашивать её
  // реже (раньше Ralph спрашивал каждые несколько секунд и всегда получал пустой ответ).
  readonly serverOwned: boolean;
};

export class ListPendingMonitoringAnalysisJobs {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; limit?: number }): Promise<PendingMonitoringAnalysisJobList> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    if (await this.serverHandles()) return { jobs: [], serverOwned: true };
    const jobs = await this.deps.monitoringAnalysisJobs.listPendingForDispatcher(input.userId, limit);
    return { jobs, serverOwned: false };
  }

  // Сбой проверки не должен останавливать диспетчера: claim атомарен, двойного исполнения нет.
  private async serverHandles(): Promise<boolean> {
    if (!this.deps.serverHandles) return false;
    return this.deps.serverHandles().catch(() => false);
  }
}
