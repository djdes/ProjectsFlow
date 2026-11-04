import type { SendUrgentTaskReminders } from '../../application/urgent-reminder/SendUrgentTaskReminders.js';
import { currentUrgentReminderSlot } from '../../domain/task/urgentTaskReminder.js';
import { mskNow } from './mskClock.js';

// Weekday 08:00 / 16:00 MSK urgent task reminders. Ticks every minute; one scan per slot per
// process. Per-task claims in the DB (db/179) keep a restarted process from repeating a slot.
export class UrgentTaskReminderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly doneSlots = new Set<string>();

  constructor(
    private readonly deps: {
      readonly send: Pick<SendUrgentTaskReminders, 'execute'>;
      // Pause of scheduled broadcasts (broadcastPause.ts). Absent — no pause (tests).
      readonly isPaused?: (at: Date) => boolean;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      void this.tick().catch((error) => console.warn('[urgent-reminders] tick failed', error));
    };
    this.timer = setInterval(run, 60_000);
    run();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(at: Date = new Date()): Promise<void> {
    if (this.running) return;
    if (this.deps.isPaused?.(at)) return;
    const slot = currentUrgentReminderSlot(mskNow(at));
    if (!slot || this.doneSlots.has(slot.key)) return;
    this.running = true;
    try {
      const result = await this.deps.send.execute(slot);
      this.doneSlots.add(slot.key);
      if (result.taskCount > 0) console.log('[urgent-reminders] sent', slot.key, result);
    } finally {
      this.running = false;
    }
  }
}
