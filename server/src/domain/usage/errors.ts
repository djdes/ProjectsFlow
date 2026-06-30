import type { WindowLabel } from './UsageWindow.js';

// Бросается гейтом enforcement, когда подписка исчерпала окно. Презентация мапит в HTTP 402.
export class UsageBlockedError extends Error {
  constructor(
    readonly window: WindowLabel,
    readonly resetsAt: Date | null,
  ) {
    super(`usage budget exceeded for window ${window}`);
    this.name = 'UsageBlockedError';
  }
}
