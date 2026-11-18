// Последняя активность агент-токенов (диспетчер / воркер) по userId — для «живости»
// LIVE-вкладки: «Диспетчер видел очередь N с назад». Только память процесса: прод
// крутится одним PM2-процессом (ecosystem.config.cjs, fork, instances: 1); после
// рестарта данных нет, и клиент отличает «нет данных» от «давно молчит» по trackedSince.
const MAX_TRACKED = 10_000;

export class AgentActivityTracker {
  private readonly seen = new Map<string, number>();
  readonly trackedSince: Date;

  constructor(now: Date = new Date()) {
    this.trackedSince = now;
  }

  touch(userId: string, now: Date = new Date()): void {
    if (this.seen.size >= MAX_TRACKED && !this.seen.has(userId)) this.seen.clear();
    this.seen.set(userId, now.getTime());
  }

  lastSeen(userId: string): Date | null {
    const at = this.seen.get(userId);
    return at === undefined ? null : new Date(at);
  }
}

// Один экземпляр на процесс: пишет agentApiRouter, читает tasksRouter.
export const agentActivity = new AgentActivityTracker();
