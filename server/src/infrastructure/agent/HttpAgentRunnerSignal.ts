import type { AgentRunnerSignal } from '../../application/agent/AgentRunnerSignal.js';

/**
 * POST на /wake локального runner'а. В Plan A endpoint никем не поднят —
 * AbortController с коротким timeout'ом гарантирует, что enqueue не виснет.
 */
export class HttpAgentRunnerSignal implements AgentRunnerSignal {
  constructor(private readonly signalUrl: string) {}

  async notifyJobEnqueued(): Promise<void> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    try {
      await fetch(`${this.signalUrl}/wake`, { method: 'POST', signal: ctrl.signal });
    } catch {
      // Best-effort. Runner поднимется через polling в Plan B.
    } finally {
      clearTimeout(t);
    }
  }
}
