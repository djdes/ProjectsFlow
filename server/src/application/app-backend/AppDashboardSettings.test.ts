import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import {
  ManageAppDashboardSettings,
  type AppDashboardSettings,
} from './AppDashboardSettings.js';

function setup(role: 'owner' | 'editor' | 'viewer' = 'editor') {
  let stored: AppDashboardSettings | null = null;
  const manage = new ManageAppDashboardSettings({
    projects: { async getById() { return { id: 'project-1' } as any; } } as any,
    members: { async findForProject() { return { projectId: 'project-1', userId: 'user-1', role, joinedAt: new Date() }; } } as any,
    settings: {
      async get() { return stored; },
      async put(_projectId, settings) { stored = settings; return settings; },
    },
  });
  return { manage, stored: () => stored };
}

test('Dashboard settings persist partial project-scoped updates and preserve existing values', async () => {
  const { manage, stored } = setup();
  const first = await manage.update('project-1', 'user-1', {
    profile: { description: 'Storefront', mainRoute: '/catalog', visibility: 'public' },
    seo: { title: 'Catalog', robotsIndex: true },
    customDomain: { hostname: 'Shop.Example.com' },
    integrations: { webhooks: 'pending' },
  });
  assert.equal(first.profile.mainRoute, '/catalog');
  assert.equal(first.customDomain.hostname, 'shop.example.com');
  assert.equal(first.customDomain.status, 'pending');
  assert.equal(first.integrations.webhooks, 'pending');

  const second = await manage.update('project-1', 'user-1', { auth: { emailPassword: false } });
  assert.equal(second.profile.description, 'Storefront');
  assert.equal(second.auth.emailPassword, false);
  assert.equal(stored()?.seo.title, 'Catalog');
});

test('Dashboard settings reject invalid route/domain and viewer writes', async () => {
  const { manage } = setup();
  await assert.rejects(() => manage.update('project-1', 'user-1', { profile: { mainRoute: 'catalog' } }), /invalid_main_route/);
  await assert.rejects(() => manage.update('project-1', 'user-1', { customDomain: { hostname: 'https:\/\/example.com\/path' } }), /invalid_custom_domain/);
  const viewer = setup('viewer').manage;
  await assert.rejects(() => viewer.update('project-1', 'user-1', { seo: { title: 'Denied' } }), InsufficientProjectRoleError);
});
