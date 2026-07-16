import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublishProject } from './PublishProject.js';
import { UnpublishProject } from './UnpublishProject.js';
import { SetPublicIndexing } from './SetPublicIndexing.js';
import { SetPublicAppearance } from './SetPublicAppearance.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import {
  DEFAULT_PUBLIC_APPEARANCE,
  type Project,
  type PublicAppearance,
} from '../../domain/project/Project.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    ownerId: 'u1',
    name: 'Persona',
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
    publicAppearance: DEFAULT_PUBLIC_APPEARANCE,
    appRepoFullName: null,
    siteSlug: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

type Calls = {
  publish: Array<{ id: string; slug: string }>;
  unpublish: string[];
  setIndexing: Array<{ id: string; on: boolean }>;
  setAppearance: Array<{ id: string; appearance: PublicAppearance }>;
};

// Фейки репозиториев: фиксируем вызовы, эмулируем slug_taken по набору «занятых» slug'ов.
function makeDeps(opts: {
  project: Project | null;
  role: ProjectRole | null; // null = юзер не member (findForProject → null)
  takenSlugs?: Set<string>;
}): { deps: { projects: ProjectRepository; members: ProjectMemberRepository }; calls: Calls } {
  const calls: Calls = { publish: [], unpublish: [], setIndexing: [], setAppearance: [] };
  const taken = opts.takenSlugs ?? new Set<string>();

  const projects = {
    async getById(id: string) {
      return opts.project && opts.project.id === id ? opts.project : null;
    },
    async publish(id: string, slug: string): Promise<'ok' | 'slug_taken'> {
      calls.publish.push({ id, slug });
      // Повторная публикация того же проекта своим же slug — всегда ok (UNIQUE на себя не бьёт).
      if (opts.project?.publicSlug === slug) return 'ok';
      if (taken.has(slug)) return 'slug_taken';
      return 'ok';
    },
    async unpublish(id: string) {
      calls.unpublish.push(id);
    },
    async setPublicIndexing(id: string, on: boolean) {
      calls.setIndexing.push({ id, on });
    },
    async update(id: string, patch: { publicAppearance?: PublicAppearance }) {
      if (patch.publicAppearance) calls.setAppearance.push({ id, appearance: patch.publicAppearance });
      return opts.project;
    },
  } as unknown as ProjectRepository;

  const members = {
    async findForProject(projectId: string, userId: string) {
      if (opts.role === null) return null;
      return { projectId, userId, role: opts.role, joinedAt: new Date() };
    },
  } as unknown as ProjectMemberRepository;

  return { deps: { projects, members }, calls };
}

test('PublishProject: owner без slug → генерирует slug, публикует, возвращает его', async () => {
  const { deps, calls } = makeDeps({ project: makeProject(), role: 'owner' });
  const uc = new PublishProject({ ...deps, generateSlug: () => 'sunny-harbor-abc123' });
  const out = await uc.execute({ id: 'p1', ownerId: 'u1' });
  assert.equal(out.slug, 'sunny-harbor-abc123');
  assert.deepEqual(calls.publish, [{ id: 'p1', slug: 'sunny-harbor-abc123' }]);
});

test('PublishProject: уже опубликован → тот же slug (URL не меняется)', async () => {
  const project = makeProject({ publicSlug: 'cookie-opinion-k3f9q2', isPublic: false });
  const { deps, calls } = makeDeps({ project, role: 'owner' });
  // generateSlug не должен вызываться — используем существующий slug.
  const uc = new PublishProject({ ...deps, generateSlug: () => 'SHOULD-NOT-BE-USED' });
  const out = await uc.execute({ id: 'p1', ownerId: 'u1' });
  assert.equal(out.slug, 'cookie-opinion-k3f9q2');
  assert.deepEqual(calls.publish, [{ id: 'p1', slug: 'cookie-opinion-k3f9q2' }]);
});

test('PublishProject: коллизия slug → повторная генерация до успеха', async () => {
  const { deps, calls } = makeDeps({
    project: makeProject(),
    role: 'owner',
    takenSlugs: new Set(['taken-slug-000001']),
  });
  const seq = ['taken-slug-000001', 'free-slug-000002'];
  let i = 0;
  const uc = new PublishProject({ ...deps, generateSlug: () => seq[i++]! });
  const out = await uc.execute({ id: 'p1', ownerId: 'u1' });
  assert.equal(out.slug, 'free-slug-000002');
  assert.equal(calls.publish.length, 2);
});

test('PublishProject: editor (не owner) → InsufficientProjectRoleError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'editor' });
  const uc = new PublishProject({ ...deps, generateSlug: () => 'x-y-z' });
  await assert.rejects(
    () => uc.execute({ id: 'p1', ownerId: 'u1' }),
    InsufficientProjectRoleError,
  );
});

test('UnpublishProject: owner → снимает с публикации', async () => {
  const project = makeProject({ publicSlug: 'cookie-opinion-k3f9q2', isPublic: true });
  const { deps, calls } = makeDeps({ project, role: 'owner' });
  await new UnpublishProject(deps).execute({ id: 'p1', ownerId: 'u1' });
  assert.deepEqual(calls.unpublish, ['p1']);
});

test('UnpublishProject: viewer → InsufficientProjectRoleError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'viewer' });
  await assert.rejects(
    () => new UnpublishProject(deps).execute({ id: 'p1', ownerId: 'u1' }),
    InsufficientProjectRoleError,
  );
});

test('SetPublicIndexing: owner → проставляет флаг', async () => {
  const project = makeProject({ publicSlug: 'cookie-opinion-k3f9q2', isPublic: true });
  const { deps, calls } = makeDeps({ project, role: 'owner' });
  await new SetPublicIndexing(deps).execute({ id: 'p1', ownerId: 'u1', indexing: true });
  assert.deepEqual(calls.setIndexing, [{ id: 'p1', on: true }]);
});

test('SetPublicAppearance: owner → сохраняет только whitelisted-настройки оформления', async () => {
  const project = makeProject({ publicSlug: 'cookie-opinion-k3f9q2', isPublic: true });
  const { deps, calls } = makeDeps({ project, role: 'owner' });
  const appearance: PublicAppearance = {
    accentColor: '#7c3aed',
    showCover: false,
    showIcon: true,
    showDescription: false,
    showTaskMeta: true,
  };
  await new SetPublicAppearance(deps).execute({ id: 'p1', userId: 'u1', appearance });
  assert.deepEqual(calls.setAppearance, [{ id: 'p1', appearance }]);
});

test('SetPublicAppearance: editor не может менять публичное оформление', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'editor' });
  await assert.rejects(
    () =>
      new SetPublicAppearance(deps).execute({
        id: 'p1',
        userId: 'u2',
        appearance: DEFAULT_PUBLIC_APPEARANCE,
      }),
    InsufficientProjectRoleError,
  );
});
