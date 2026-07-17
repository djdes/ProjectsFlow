import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { WorkspaceAssigneeDigestScheduler } from './WorkspaceAssigneeDigestScheduler.js';

function harness() {
  const calls: string[] = [];
  const settings = {
    async listScheduled() {
      return [{
        ...defaultWorkspaceAssigneeDigestSettings('w1'),
        enabled: true,
        hour: 9,
        telegramGroupChatId: -1007,
        commitSyncEnabled: true,
        eodReminderEnabled: true,
      }];
    },
    async markSent() { calls.push('mark:digest'); },
    async markCommitSyncSent() { calls.push('mark:commit'); },
    async markEodReminderSent() { calls.push('mark:eod'); },
  };
  const scheduler = new WorkspaceAssigneeDigestScheduler({
    settings: settings as never,
    send: { async execute() { calls.push('digest'); } } as never,
    projects: {
      async listByWorkspace() { return [{ id: 'p1', name: 'DocsFlow', icon: null }]; },
    } as never,
    enqueueCommitSync: {
      async execute(_projectId: string, _at: Date, opts: { forceEnabled?: boolean }) {
        assert.equal(opts.forceEnabled, true);
        calls.push('commit');
      },
    } as never,
    sendEodReminder: { async execute() { calls.push('eod'); } } as never,
  });
  return { scheduler, calls };
}

test('workspace Telegram schedule never sends on weekends', async () => {
  const { scheduler, calls } = harness();
  await scheduler.tick(new Date('2026-07-18T14:21:00.000Z')); // Saturday 17:21 MSK
  assert.deepEqual(calls, []);
});

test('workspace Telegram schedule runs all due weekday automations once', async () => {
  const { scheduler, calls } = harness();
  await scheduler.tick(new Date('2026-07-17T14:21:00.000Z')); // Friday 17:21 MSK
  assert.deepEqual(calls, [
    'digest', 'mark:digest',
    'commit', 'mark:commit',
    'eod', 'mark:eod',
  ]);
});
