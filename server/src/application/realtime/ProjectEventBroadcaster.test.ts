import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { RealtimeEvent } from '../../domain/realtime/RealtimeEvent.js';
import type { RealtimePublisher } from './RealtimePublisher.js';
import { ProjectEventBroadcaster } from './ProjectEventBroadcaster.js';

test('live lifecycle reaches the initiator immediately and members without duplicates', async () => {
  let releaseMembers!: () => void;
  const membersReady = new Promise<void>((resolve) => {
    releaseMembers = resolve;
  });
  const published: Array<{ userId: string; event: RealtimeEvent }> = [];

  const members = {
    async listByProject() {
      await membersReady;
      return [
        { userId: 'member-1' },
        { userId: 'member-2' },
      ];
    },
  } as unknown as ProjectMemberRepository;
  const publisher: RealtimePublisher = {
    publish(userId, event) {
      published.push({ userId, event });
    },
  };
  const broadcaster = new ProjectEventBroadcaster({ members, publisher });

  const broadcast = broadcaster.broadcastLiveSessionChanged(
    'project-1',
    'task-1',
    'session-1',
    'running',
    ['member-1', 'dispatcher-1'],
  );

  // Explicit recipients are notified before the member repository resolves.
  assert.deepEqual(
    published.map(({ userId }) => userId),
    ['member-1', 'dispatcher-1'],
  );

  releaseMembers();
  await broadcast;

  assert.deepEqual(
    published.map(({ userId }) => userId),
    ['member-1', 'dispatcher-1', 'member-2'],
  );
  assert.ok(published.every(({ event }) => event.kind === 'live_session_changed'));
});
