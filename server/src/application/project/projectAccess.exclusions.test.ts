import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureAdminBypass, requireProjectAccess, type ProjectAccessDeps } from './projectAccess.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

test('explicit hidden project is inaccessible by direct URL even with platform admin bypass', async () => {
  configureAdminBypass(async () => true);
  let projectRead = false;
  try {
    const deps = {
      members: { findForProject: async () => null, isProjectHidden: async () => true },
      projects: { getById: async () => { projectRead = true; return { id: 'hidden' }; } },
    } as unknown as ProjectAccessDeps;
    await assert.rejects(requireProjectAccess(deps, 'hidden', 'restricted-admin', 'read_project'), ProjectNotFoundError);
    assert.equal(projectRead, false);
  } finally { configureAdminBypass(async () => false); }
});
