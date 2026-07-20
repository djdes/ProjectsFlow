import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import {
  WebhookEventsInvalidError,
  WebhookLimitError,
  WebhookNotFoundError,
  WebhookUrlInvalidError,
  MAX_WEBHOOKS_PER_PROJECT,
} from '../../domain/integrations/ProjectWebhook.js';
import { DispatchWebhook } from './DispatchWebhook.js';
import {
  ManageWebhooks,
  type ProjectWebhookRecord,
  type ProjectWebhookRepository,
} from './ManageWebhooks.js';

const PROJECT_ID = 'project-1';
const EDITOR_ID = 'user-editor';
const VIEWER_ID = 'user-viewer';

function makeProject(): Project {
  return {
    id: PROJECT_ID,
    ownerId: 'owner',
    name: 'Roadmap',
    icon: null,
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    kbKind: 'none',
    financeVisibility: 'owner',
    dispatcherUserId: null,
    multiTaskWorker: false,
    isInbox: false,
    description: null,
    coverUrl: null,
    coverPosition: 50,
    publicSlug: null,
    isPublic: false,
    publicIndexing: false,
    appRepoFullName: null,
    siteSlug: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

class FakeWebhookRepo implements ProjectWebhookRepository {
  records: ProjectWebhookRecord[] = [];
  async listByProject(projectId: string): Promise<readonly ProjectWebhookRecord[]> {
    return this.records.filter((r) => r.projectId === projectId);
  }
  async getById(projectId: string, id: string): Promise<ProjectWebhookRecord | null> {
    return this.records.find((r) => r.projectId === projectId && r.id === id) ?? null;
  }
  async countByProject(projectId: string): Promise<number> {
    return this.records.filter((r) => r.projectId === projectId).length;
  }
  async insert(record: ProjectWebhookRecord): Promise<void> {
    this.records.push(record);
  }
  async update(
    projectId: string,
    id: string,
    patch: { url?: string; events?: readonly string[]; enabled?: boolean },
  ): Promise<ProjectWebhookRecord | null> {
    const idx = this.records.findIndex((r) => r.projectId === projectId && r.id === id);
    if (idx < 0) return null;
    const cur = this.records[idx]!;
    const next: ProjectWebhookRecord = {
      ...cur,
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.events !== undefined ? { events: patch.events as ProjectWebhookRecord['events'] } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    };
    this.records[idx] = next;
    return next;
  }
  async delete(projectId: string, id: string): Promise<boolean> {
    const before = this.records.length;
    this.records = this.records.filter((r) => !(r.projectId === projectId && r.id === id));
    return this.records.length < before;
  }
  async recordDelivery(): Promise<void> {}
}

function makeHarness(roles: Record<string, ProjectRole>): {
  manage: ManageWebhooks;
  repo: FakeWebhookRepo;
} {
  const repo = new FakeWebhookRepo();
  let counter = 0;
  const deps = {
    projects: {
      getById: async (id: string) => (id === PROJECT_ID ? makeProject() : null),
    },
    members: {
      findForProject: async (projectId: string, userId: string): Promise<ProjectMembership | null> => {
        const role = roles[userId];
        if (!role || projectId !== PROJECT_ID) return null;
        return { projectId, userId, role, joinedAt: new Date() };
      },
    },
    webhooks: repo,
    dispatcher: new DispatchWebhook({
      webhooks: repo,
      fetchImpl: async () => new Response('ok', { status: 200 }),
    }),
    idGen: () => `wh-${(counter += 1)}`,
    now: () => new Date('2026-07-20T10:00:00.000Z'),
  } as unknown as ConstructorParameters<typeof ManageWebhooks>[0];
  return { manage: new ManageWebhooks(deps), repo };
}

test('create возвращает секрет ОДИН раз, в базе — только hash', async () => {
  const { manage, repo } = makeHarness({ [EDITOR_ID]: 'editor' });
  const created = await manage.create(PROJECT_ID, EDITOR_ID, {
    url: 'https://hooks.example.com/pf',
    events: ['task.created', 'task.status_changed'],
  });

  assert.match(created.secret, /^whsec_[0-9a-f]{48}$/);
  // Публичная форма НЕ содержит секрета и не содержит хеша.
  assert.equal('secret' in created.webhook, false);
  assert.equal('secretHash' in created.webhook, false);

  // В хранилище лежит только hash секрета, а не сам секрет.
  const stored = repo.records[0]!;
  const expectedHash = createHash('sha256').update(created.secret).digest('hex');
  assert.equal(stored.secretHash, expectedHash);
  assert.notEqual(stored.secretHash, created.secret);

  // list не отдаёт secretHash наружу.
  const listed = await manage.list(PROJECT_ID, EDITOR_ID);
  assert.equal(listed.length, 1);
  assert.equal('secretHash' in listed[0]!, false);
  assert.deepEqual([...listed[0]!.events], ['task.created', 'task.status_changed']);
});

test('create отклоняет не-HTTPS и приватный URL на уровне нормализации', async () => {
  const { manage } = makeHarness({ [EDITOR_ID]: 'editor' });
  await assert.rejects(
    () => manage.create(PROJECT_ID, EDITOR_ID, { url: 'http://127.0.0.1:4317', events: ['task.created'] }),
    WebhookUrlInvalidError,
  );
  await assert.rejects(
    () => manage.create(PROJECT_ID, EDITOR_ID, { url: 'https://x.example/pf', events: ['nope'] }),
    WebhookEventsInvalidError,
  );
});

test('create требует роль editor+ (viewer запрещён)', async () => {
  const { manage } = makeHarness({ [VIEWER_ID]: 'viewer' });
  await assert.rejects(
    () => manage.create(PROJECT_ID, VIEWER_ID, { url: 'https://x.example/pf', events: ['*'] }),
    InsufficientProjectRoleError,
  );
});

test('create упирается в лимит подписок', async () => {
  const { manage, repo } = makeHarness({ [EDITOR_ID]: 'editor' });
  for (let i = 0; i < MAX_WEBHOOKS_PER_PROJECT; i += 1) {
    repo.records.push({
      id: `seed-${i}`,
      projectId: PROJECT_ID,
      url: 'https://x.example/pf',
      events: ['*'],
      enabled: true,
      lastStatus: null,
      lastAt: null,
      createdAt: '2026-07-20T00:00:00.000Z',
      secretHash: 'b'.repeat(64),
    });
  }
  await assert.rejects(
    () => manage.create(PROJECT_ID, EDITOR_ID, { url: 'https://x.example/pf', events: ['*'] }),
    WebhookLimitError,
  );
});

test('update и remove работают, remove несуществующего → WebhookNotFoundError', async () => {
  const { manage } = makeHarness({ [EDITOR_ID]: 'editor' });
  const created = await manage.create(PROJECT_ID, EDITOR_ID, {
    url: 'https://x.example/pf',
    events: ['task.created'],
  });
  const updated = await manage.update(PROJECT_ID, EDITOR_ID, created.webhook.id, {
    enabled: false,
    events: ['*'],
  });
  assert.equal(updated.enabled, false);
  assert.deepEqual([...updated.events], ['*']);

  await manage.remove(PROJECT_ID, EDITOR_ID, created.webhook.id);
  await assert.rejects(
    () => manage.remove(PROJECT_ID, EDITOR_ID, created.webhook.id),
    WebhookNotFoundError,
  );
});
