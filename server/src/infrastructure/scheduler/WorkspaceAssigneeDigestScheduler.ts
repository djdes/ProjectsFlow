import type { WorkspaceAssigneeDigestRepository } from '../../application/digest/WorkspaceAssigneeDigestRepository.js';
import type { SendWorkspaceAssigneeDigest } from '../../application/digest/SendWorkspaceAssigneeDigest.js';
import type { EnqueueCommitSyncJob } from '../../application/commit-sync/EnqueueCommitSyncJob.js';
import type { SendWorkspaceEodReminder } from '../../application/eod/SendWorkspaceEodReminder.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';

function mskNow(at: Date): { hour: number; minute: number; date: string; weekend: boolean } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [year, month, day] = date.split('-').map(Number);
  const weekDay = new Date(Date.UTC(year!, (month ?? 1) - 1, day!)).getUTCDay();
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
      readonly projects: ProjectRepository;
      readonly enqueueCommitSync: EnqueueCommitSyncJob;
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
        // Workspace Telegram automations are intentionally business-day only.
        if (now.weekend) continue;
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

        const commitMinutes = item.commitSyncHour * 60 + item.commitSyncMinute;
        if (
          item.commitSyncEnabled &&
          nowMinutes >= commitMinutes &&
          item.commitSyncLastSentOn !== now.date
        ) {
          try {
            const configured = new Set(item.projectIds);
            const projects = (await this.deps.projects.listByWorkspace(item.workspaceId)).filter(
              (project) => item.projectMode === 'all' || configured.has(project.id),
            );
            for (const project of projects) {
              await this.deps.enqueueCommitSync.execute(project.id, at, {
                forceEnabled: true,
              });
            }
          } catch (error) {
            console.warn('[workspace-commit-sync] enqueue failed', item.workspaceId, error);
          } finally {
            await this.deps.settings
              .markCommitSyncSent(item.workspaceId, now.date)
              .catch(() => undefined);
          }
        }

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
