import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublishSiteArtifact, injectDashboardMetadata } from './PublishSiteArtifact.js';
import { NotAssignedDispatcherError } from '../../domain/file-sync/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { SiteArtifact } from '../../domain/site/SiteArtifact.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1', ownerId: 'owner1', name: 'Landing', icon: null, status: 'active',
    gitRepoUrl: null, kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner',
    dispatcherUserId: 'disp1', multiTaskWorker: false, isInbox: false,
    description: null, coverUrl: null, coverPosition: 50,
    publicSlug: null, isPublic: false, publicIndexing: false, appRepoFullName: 'octocat/pf-x', siteSlug: null,
    createdAt: new Date('2026-01-01'), ...over,
  };
}

function makeDeps(opts: { project: Project; existing?: SiteArtifact | null; taken?: Set<string> }) {
  const taken = opts.taken ?? new Set<string>();
  const stored: { slug?: string; files?: number } = {};
  let row: SiteArtifact | null = opts.existing ?? null;
  const deps = {
    projects: { async getById(id: string) { return opts.project.id === id ? opts.project : null; } },
    members: {},
    sites: {
      async getByProject() { return row; },
      async getBySlug(slug: string) { return taken.has(slug) ? ({ slug } as SiteArtifact) : null; },
      async upsert(input: { projectId: string; slug: string; fileCount: number; bytes: number }) {
        row = { ...input, publishedAt: new Date('2026-03-03') };
        return row;
      },
    },
    storage: {
      async replaceSite(slug: string, files: readonly { path: string; data: Buffer }[]) {
        stored.slug = slug;
        stored.files = files.length;
        return { fileCount: files.length, bytes: files.reduce((n, f) => n + f.data.length, 0) };
      },
      siteDir(slug: string) { return `/sites/${slug}`; },
    },
  } as any;
  return { deps, stored };
}

const FILES = [
  { path: 'index.html', data: Buffer.from('<html>') },
  { path: 'assets/app.js', data: Buffer.from('code') },
];

test('PublishSiteArtifact: диспетчер, нет сайта → генерит slug, кладёт файлы, upsert', async () => {
  const { deps, stored } = makeDeps({ project: makeProject() });
  const uc = new PublishSiteArtifact({ ...deps, generateSlug: () => 'sunny-harbor-a1b2c3' });
  const out = await uc.execute('p1', 'disp1', FILES);
  assert.equal(out.slug, 'sunny-harbor-a1b2c3');
  assert.equal(stored.slug, 'sunny-harbor-a1b2c3');
  assert.equal(stored.files, 2);
});

test('PublishSiteArtifact: уже есть сайт → тот же slug (не генерим)', async () => {
  const existing: SiteArtifact = {
    projectId: 'p1', slug: 'cookie-opinion-x', fileCount: 1, bytes: 10, publishedAt: new Date(),
  };
  const { deps } = makeDeps({ project: makeProject(), existing });
  const uc = new PublishSiteArtifact({ ...deps, generateSlug: () => 'SHOULD-NOT-USE' });
  const out = await uc.execute('p1', 'disp1', FILES);
  assert.equal(out.slug, 'cookie-opinion-x');
});

test('PublishSiteArtifact: коллизия slug → повторная генерация', async () => {
  const { deps, stored } = makeDeps({ project: makeProject(), taken: new Set(['taken-000001']) });
  const seq = ['taken-000001', 'free-000002'];
  let i = 0;
  const uc = new PublishSiteArtifact({ ...deps, generateSlug: () => seq[i++]! });
  const out = await uc.execute('p1', 'disp1', FILES);
  assert.equal(out.slug, 'free-000002');
  assert.equal(stored.slug, 'free-000002');
});

test('PublishSiteArtifact: не диспетчер → NotAssignedDispatcherError', async () => {
  const { deps } = makeDeps({ project: makeProject({ dispatcherUserId: 'someone-else' }) });
  const uc = new PublishSiteArtifact({ ...deps, generateSlug: () => 'x-y-z' });
  await assert.rejects(() => uc.execute('p1', 'disp1', FILES), NotAssignedDispatcherError);
});

test('injectDashboardMetadata replaces existing SEO and safely injects JSON-LD', () => {
  const result = injectDashboardMetadata('<html><head><title>Old</title><meta name="description" content="old"></head><body></body></html>', {
    title: 'New & better',
    description: 'Description',
    canonicalUrl: 'https://example.com/page',
    robotsIndex: true,
    socialImageUrl: 'https://example.com/cover.png',
    showPlatformBadge: true,
    structuredData: '{"name":"safe </script> value"}',
  });
  assert.doesNotMatch(result, /<title>Old<\/title>/);
  assert.match(result, /<title>New &amp; better<\/title>/);
  assert.match(result, /name="robots" content="index,follow"/);
  assert.match(result, /rel="canonical" href="https:\/\/example\.com\/page"/);
  assert.match(result, /safe <\\\/script> value/);
  assert.match(result, /data-projectsflow-badge/);
});
