/**
 * Сигнал runner-процессу: «есть новая job, проснись и сделай claim».
 * В Plan A реализация — Noop (логирует и игнорирует). В Plan B — Http (POST на :4318/wake).
 */
export type AgentRunnerSignal = {
  notifyJobEnqueued(): Promise<void>;
};
