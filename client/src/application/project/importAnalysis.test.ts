import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectImportAnalysis } from './ProjectRepository';
import { canCommitProjectImport, projectImportTechnology } from './importAnalysis';

function analysis(status: ProjectImportAnalysis['status']): ProjectImportAnalysis {
  return {
    status,
    kind: 'vite',
    framework: 'Vite',
    packageManager: 'npm',
    rootDir: '.',
    buildCommand: 'npm run build',
    startCommand: null,
    outputDir: 'dist',
    fileCount: 12,
    diagnostics: [],
    dataHints: [],
    secretFindings: [],
  };
}

test('project import can only be committed after a supported preflight', () => {
  assert.equal(canCommitProjectImport(null), false);
  assert.equal(canCommitProjectImport(analysis('needs_config')), false);
  assert.equal(canCommitProjectImport(analysis('unsupported')), false);
  assert.equal(canCommitProjectImport(analysis('supported')), true);
});

test('projectImportTechnology provides compact report metadata', () => {
  assert.equal(projectImportTechnology(analysis('supported')), 'Vite · npm · → dist');
});
