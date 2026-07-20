import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import type { AppSchema } from '../../domain/app-backend/AppSchema.js';
import type { AppAuditEntry } from './AppDatabaseStore.js';
import {
  ManageAppDashboardSettings,
  type AppDashboardSettings,
} from './AppDashboardSettings.js';

type SetupOpts = {
  readonly project?: Record<string, unknown>;
  readonly schema?: AppSchema | null;
  readonly auditRows?: readonly Partial<AppAuditEntry>[];
};

function setup(role: 'owner' | 'editor' | 'viewer' = 'editor', opts: SetupOpts = {}) {
  let stored: AppDashboardSettings | null = null;
  const auditRows = (opts.auditRows ?? []).map((row) => ({
    id: 'a', createdAt: new Date().toISOString(), success: true, actorType: 'project_member',
    operation: '', ...row,
  })) as AppAuditEntry[];
  const manage = new ManageAppDashboardSettings({
    projects: { async getById() { return { id: 'project-1', ...(opts.project ?? {}) } as any; } } as any,
    members: { async findForProject() { return { projectId: 'project-1', userId: 'user-1', role, joinedAt: new Date() }; } } as any,
    settings: {
      async get() { return stored; },
      async put(_projectId, settings) { stored = settings; return settings; },
    },
    appBackends: 'schema' in opts ? ({
      async getByProject() { return { schema: opts.schema ?? null } as any; },
    } as any) : undefined,
    adminAudit: opts.auditRows ? ({
      async list(_projectId: string, listOpts?: { operation?: string }) {
        const rows = listOpts?.operation
          ? auditRows.filter((row) => row.operation === listOpts.operation)
          : auditRows;
        return { rows, total: rows.length };
      },
      async record() { throw new Error('not used'); },
    } as any) : undefined,
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

test('Security scan flags a publicly readable table with a sensitive column as critical', async () => {
  const schema: AppSchema = {
    tables: [
      {
        name: 'accounts',
        rules: { read: 'anyone', write: 'owner' },
        fields: [
          { name: 'id', type: 'text' },
          { name: 'api_key', type: 'text' },
        ],
      },
    ],
  };
  const { manage } = setup('owner', { schema });
  const scan = await manage.scanSecurity('project-1', 'user-1');
  const critical = scan.findings.find((f) => f.code === 'public_read_sensitive:accounts');
  assert.ok(critical, 'expected a public_read_sensitive finding');
  assert.equal(critical?.severity, 'critical');
  assert.match(critical!.remediation, /api_key/);
});

test('Security scan warns about sensitive-named columns without an explicit flag', async () => {
  const schema: AppSchema = {
    tables: [
      {
        name: 'people',
        rules: { read: 'authenticated', write: 'owner' },
        fields: [
          { name: 'id', type: 'text' },
          { name: 'email', type: 'text' }, // heuristic-only, no explicit flag
          { name: 'note', type: 'text', sensitive: 'secret' }, // explicit → not flagged
        ],
      },
    ],
  };
  const { manage } = setup('owner', { schema });
  const scan = await manage.scanSecurity('project-1', 'user-1');
  const warn = scan.findings.find((f) => f.code === 'sensitive_unflagged:people');
  assert.ok(warn, 'expected a sensitive_unflagged finding');
  assert.equal(warn?.severity, 'warning');
  assert.match(warn!.remediation, /email/);
  assert.doesNotMatch(warn!.remediation, /note/); // explicit flag is not "unflagged"
  // authenticated read → no critical for this table
  assert.equal(scan.findings.some((f) => f.code.startsWith('public_read_sensitive')), false);
});

test('Security scan reports recent sensitivity-flag removal and large exports', async () => {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const { manage } = setup('owner', {
    auditRows: [
      { operation: 'dashboard.sensitivity_changed', createdAt: iso(now - 60_000), detail: { field: 'token', from: 'secret', to: null } },
      { operation: 'dashboard.sensitivity_changed', createdAt: iso(now - 60_000), detail: { field: 'city', from: null, to: 'pii' } }, // a set, not a removal
      { operation: 'dashboard.export', createdAt: iso(now - 60_000), detail: { rows: 700 } },
      { operation: 'dashboard.export', createdAt: iso(now - 120_000), detail: { rows: 500 } },
      { operation: 'dashboard.export', createdAt: iso(now - 8 * 24 * 60 * 60 * 1000), detail: { rows: 9000 } }, // outside 24h window
    ],
  });
  const scan = await manage.scanSecurity('project-1', 'user-1');
  const removal = scan.findings.find((f) => f.code === 'sensitivity_flag_removed');
  assert.ok(removal, 'expected sensitivity_flag_removed finding');
  assert.match(removal!.remediation, /token/);
  assert.doesNotMatch(removal!.remediation, /city/);
  const volume = scan.findings.find((f) => f.code === 'export_volume_high');
  assert.ok(volume, 'expected export_volume_high finding (700 + 500 > 1000)');
  assert.match(volume!.title, /1200/);
});

test('Security scan warns when test data is enabled on a public project', async () => {
  const { manage } = setup('owner');
  await manage.update('project-1', 'user-1', {
    profile: { visibility: 'public' },
    advanced: { testData: true },
  });
  const scan = await manage.scanSecurity('project-1', 'user-1');
  assert.ok(scan.findings.some((f) => f.code === 'test_data_public' && f.severity === 'warning'));
});

test('Security scan degrades safely without schema/audit dependencies', async () => {
  const { manage } = setup('owner'); // no schema, no auditRows
  const scan = await manage.scanSecurity('project-1', 'user-1');
  assert.equal(scan.findings.some((f) => f.code.startsWith('public_read_sensitive')), false);
  assert.equal(scan.findings.some((f) => f.code === 'export_volume_high'), false);
});
