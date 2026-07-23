import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { WorkspaceAssigneeDigestScheduler } from './WorkspaceAssigneeDigestScheduler.js';

function harness(daysOfWeek: Array<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5]) {
  const calls: string[] = [];
  const settings = {
    async listScheduled() {
      return [{
        ...defaultWorkspaceAssigneeDigestSettings('w1'),
        enabled: true,
        hour: 9,
        daysOfWeek,
        telegramGroupChatId: -1007,
        commitSyncEnabled: true,
        eodReminderEnabled: true,
      }];
    },
    async markSent() { calls.push('mark:digest'); },
    async markEodReminderSent() { calls.push('mark:eod'); },
  };
  // Сверка коммитов больше НЕ в этом планировщике (её ведёт per-project CommitSyncScheduler,
  // db/141) — поэтому ни enqueueCommitSync-дока, ни 'commit'/'mark:commit' в ожидаемых вызовах.
  const scheduler = new WorkspaceAssigneeDigestScheduler({
    settings: settings as never,
    send: { async execute() { calls.push('digest'); } } as never,
    projects: {
      async listByWorkspace() { return [{ id: 'p1', name: 'DocsFlow', icon: null }]; },
    } as never,
    sendEodReminder: { async execute() { calls.push('eod'); } } as never,
  });
  return { scheduler, calls };
}

test('workspace Telegram schedule skips a day that is not selected', async () => {
  const { scheduler, calls } = harness();
  await scheduler.tick(new Date('2026-07-18T14:21:00.000Z')); // Saturday 17:21 MSK
  assert.deepEqual(calls, []);
});

test('workspace Telegram schedule can run on a selected weekend day', async () => {
  const { scheduler, calls } = harness([6]);
  await scheduler.tick(new Date('2026-07-18T14:21:00.000Z')); // Saturday 17:21 MSK
  assert.deepEqual(calls, [
    'digest', 'mark:digest',
    'eod', 'mark:eod',
  ]);
});

test('workspace Telegram schedule runs all due weekday automations once', async () => {
  const { scheduler, calls } = harness();
  await scheduler.tick(new Date('2026-07-17T14:21:00.000Z')); // Friday 17:21 MSK
  assert.deepEqual(calls, [
    'digest', 'mark:digest',
    'eod', 'mark:eod',
  ]);
});
