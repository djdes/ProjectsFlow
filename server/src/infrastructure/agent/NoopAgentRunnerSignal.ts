import type { AgentRunnerSignal } from '../../application/agent/AgentRunnerSignal.js';

/** Used when RUNNER_ENABLED=false. */
export class NoopAgentRunnerSignal implements AgentRunnerSignal {
  async notifyJobEnqueued(): Promise<void> {
    // intentional no-op
  }
}
