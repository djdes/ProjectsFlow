import type { WorkspaceAssigneeDigestRepository } from '../../application/digest/WorkspaceAssigneeDigestRepository.js';
import type { SendWorkspaceAssigneeDigest } from '../../application/digest/SendWorkspaceAssigneeDigest.js';
import type { SendWorkspaceEodReminder } from '../../application/eod/SendWorkspaceEodReminder.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import { mskNow } from './mskClock.js';

export class WorkspaceAssigneeDigestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      readonly settings: WorkspaceAssigneeDigestRepository;
      readonly send: SendWorkspaceAssigneeDigest;
      readonly projects: ProjectRepository;
      readonly sendEodReminder: SendWorkspaceEodReminder;
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

  async tick(at: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = mskNow(at);
      const nowMinutes = now.hour * 60 + now.minute;
      const settings = await this.deps.settings.listScheduled();
      for (const item of settings) {
        if (!item.daysOfWeek.includes(now.dayOfWeek)) continue;
        const digestMinutes = item.hour * 60 + item.minute;
        if (item.enabled && nowMinutes >= digestMinutes && item.lastSentOn !== now.date) {
          try {
            await this.deps.send.execute(item.workspaceId);
          } catch (error) {
            console.warn('[workspace-assignee-digest] send failed', item.workspaceId, error);
          } finally {
            await this.deps.settings.markSent(item.workspaceId, now.date).catch(() => undefined);
          }
        }

        // Сверка коммитов больше НЕ здесь: ею владеет per-project CommitSyncScheduler (db/141),
        // где у каждого проекта своё время и дни, а per-project тумблер реально включает/выключает.
        // Раньше эта ветка форсила сверку по всему пространству одним временем.

        const eodMinutes = item.eodReminderHour * 60 + item.eodReminderMinute;
        if (
          item.eodReminderEnabled &&
          nowMinutes >= eodMinutes &&
          item.eodReminderLastSentOn !== now.date
        ) {
          try {
            await this.deps.sendEodReminder.execute(item.workspaceId);
          } catch (error) {
            console.warn('[workspace-eod-reminder] send failed', item.workspaceId, error);
          } finally {
            await this.deps.settings
              .markEodReminderSent(item.workspaceId, now.date)
              .catch(() => undefined);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
