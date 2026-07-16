import type { WorkspaceAssigneeDigestRepository } from '../../application/digest/WorkspaceAssigneeDigestRepository.js';
import type { SendWorkspaceAssigneeDigest } from '../../application/digest/SendWorkspaceAssigneeDigest.js';

function mskNow(): { hour: number; minute: number; date: string; weekend: boolean } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [year, month, day] = date.split('-').map(Number);
  const weekDay = new Date(year!, (month ?? 1) - 1, day!).getDay();
  return {
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    date,
    weekend: weekDay === 0 || weekDay === 6,
  };
}

export class WorkspaceAssigneeDigestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      readonly settings: WorkspaceAssigneeDigestRepository;
      readonly send: SendWorkspaceAssigneeDigest;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) =>
        console.warn('[workspace-assignee-digest] tick failed', error),
      );
    }, 60_000);
    void this.tick().catch((error) =>
      console.warn('[workspace-assignee-digest] tick failed', error),
    );
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = mskNow();
      const nowMinutes = now.hour * 60 + now.minute;
      const settings = await this.deps.settings.listEnabled();
      for (const item of settings) {
        if (item.weekdaysOnly && now.weekend) continue;
        const scheduledMinutes = item.hour * 60 + item.minute;
        if (nowMinutes < scheduledMinutes || item.lastSentOn === now.date) continue;
        try {
          await this.deps.send.execute(item.workspaceId);
        } catch (error) {
          console.warn(
            '[workspace-assignee-digest] send failed',
            item.workspaceId,
            error,
          );
        } finally {
          await this.deps.settings.markSent(item.workspaceId, now.date).catch(() => undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
