import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetAppTraffic } from './GetAppTraffic.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { AppTrafficAggregate, AppTrafficRepository } from './AppTrafficRepository.js';

function repoWith(agg: AppTrafficAggregate): AppTrafficRepository {
  return {
    async record() {},
    async countForDay() {
      return 0;
    },
    async aggregate() {
      return agg;
    },
  };
}

function deps(agg: AppTrafficAggregate, role: 'owner' | 'editor' | 'viewer' | null) {
  return {
    projects: { async getById() { return { id: 'p1' } as never; } } as never,
    members: {
      async findForProject() {
        return role ? { projectId: 'p1', userId: 'u1', role, joinedAt: new Date() } : null;
      },
    } as never,
    traffic: repoWith(agg),
  };
}

const SAMPLE: AppTrafficAggregate = {
  perDay: [
    { date: '2026-07-19', visits: 10, sessions: 4 },
    { date: '2026-07-20', visits: 6, sessions: 3 },
  ],
  byClass: { desktop: 12, mobile: 4 },
  totalVisits: 16,
  totalSessions: 6,
};

test('GetAppTraffic returns aggregates with all UA buckets defaulted to 0', async () => {
  const svc = new GetAppTraffic(deps(SAMPLE, 'viewer'));
  const traffic = await svc.get('p1', 'u1', 28);
  assert.equal(traffic.totalVisits, 16);
  assert.equal(traffic.totalSessions, 6);
  assert.equal(traffic.windowDays, 28);
  assert.deepEqual(traffic.byClass, { desktop: 12, mobile: 4, bot: 0, other: 0 });
  assert.equal(traffic.perDay.length, 2);
});

test('GetAppTraffic clamps the window to the allowed range', async () => {
  const svc = new GetAppTraffic(deps(SAMPLE, 'viewer'));
  assert.equal((await svc.get('p1', 'u1', 5000)).windowDays, 90);
  assert.equal((await svc.get('p1', 'u1', 0)).windowDays, 1);
  assert.equal((await svc.get('p1', 'u1', undefined)).windowDays, 28);
});

test('GetAppTraffic denies non-members', async () => {
  const svc = new GetAppTraffic(deps(SAMPLE, null));
  await assert.rejects(() => svc.get('p1', 'stranger', 28), ProjectNotFoundError);
});
