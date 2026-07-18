import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectImportAnalyzer } from './ProjectImportAnalyzer.js';
import type { ProjectZipFile } from './extractProjectZip.js';

function files(input: Readonly<Record<string, string>>): ProjectZipFile[] {
  return Object.entries(input).map(([path, content]) => ({ path, content: Buffer.from(content) }));
}

const analyzer = new ProjectImportAnalyzer();

test('ProjectImportAnalyzer accepts a plain static site', () => {
  const result = analyzer.analyze(files({
    'index.html': '<!doctype html><title>Static</title>',
    'assets/app.js': 'document.body.dataset.ready = "1";',
  }));
  assert.equal(result.status, 'supported');
  assert.equal(result.kind, 'static');
  assert.equal(result.outputDir, '.');
  assert.equal(result.packageManager, 'none');
});

test('ProjectImportAnalyzer detects supported Vite and Next static export projects', () => {
  const vite = analyzer.analyze(files({
    'package.json': JSON.stringify({
      scripts: { build: 'vite build' },
      devDependencies: { vite: '^7.0.0' },
    }),
    'package-lock.json': '{}',
    'index.html': '<div id="root"></div>',
  }));
  assert.equal(vite.status, 'supported');
  assert.equal(vite.kind, 'vite');
  assert.equal(vite.buildCommand, 'npm run build');
  assert.equal(vite.outputDir, 'dist');

  const next = analyzer.analyze(files({
    'package.json': JSON.stringify({
      scripts: { build: 'next build' },
      dependencies: { next: '^15.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9',
    'next.config.mjs': "export default { output: 'export' };",
  }));
  assert.equal(next.status, 'supported');
  assert.equal(next.kind, 'next-export');
  assert.equal(next.packageManager, 'pnpm');
  assert.equal(next.outputDir, 'out');
});

test('ProjectImportAnalyzer blocks Node APIs and mutable JSON databases with remediation', () => {
  const result = analyzer.analyze(files({
    'package.json': JSON.stringify({
      scripts: { start: 'node server.js' },
      dependencies: { express: '^5.0.0', lowdb: '^7.0.0' },
    }),
    'package-lock.json': '{}',
    'server.js': "import fs from 'node:fs'; fs.writeFileSync('db.json', '{}');",
    'db.json': '{"items":[]}',
  }));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.kind, 'api-only');
  assert.ok(result.diagnostics.some((item) => item.code === 'API_RUNTIME_UNSUPPORTED'));
  assert.ok(result.diagnostics.some((item) => item.code === 'MUTABLE_JSON_DB_UNSUPPORTED'));
  assert.ok(result.dataHints.some((item) => item.kind === 'lowdb'));
  assert.ok(result.dataHints.some((item) => item.kind === 'filesystem-write'));
});

test('ProjectImportAnalyzer distinguishes Next SSR from Next export', () => {
  const result = analyzer.analyze(files({
    'package.json': JSON.stringify({
      scripts: { build: 'next build', start: 'next start' },
      dependencies: { next: '^15.0.0' },
    }),
    'yarn.lock': '# yarn',
  }));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.kind, 'node-server');
  assert.ok(result.diagnostics.some((item) => item.code === 'NEXT_SSR_UNSUPPORTED'));
});

test('ProjectImportAnalyzer does not classify a Vite frontend with a Node server as static', () => {
  const result = analyzer.analyze(files({
    'package.json': JSON.stringify({
      scripts: { build: 'vite build', start: 'node server.js' },
      dependencies: { express: '^5.0.0' },
      devDependencies: { vite: '^7.0.0' },
    }),
    'package-lock.json': '{}',
    'index.html': '<div id="root"></div>',
    'server.js': "import express from 'express';",
  }));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.kind, 'node-server');
  assert.ok(result.diagnostics.some((item) => item.code === 'NODE_RUNTIME_UNSUPPORTED'));
});

test('ProjectImportAnalyzer requires package-less static sites to have a root index', () => {
  const result = analyzer.analyze(files({
    'dist/index.html': '<!doctype html><title>Prebuilt</title>',
  }));
  assert.equal(result.status, 'needs_config');
  assert.equal(result.kind, 'unknown');
  assert.ok(result.diagnostics.some((item) => item.code === 'PREBUILT_ROOT_REQUIRED'));
});

test('ProjectImportAnalyzer does not promise a Vite output directory the publisher cannot find', () => {
  const result = analyzer.analyze(files({
    'package.json': JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '*' } }),
    'package-lock.json': '{}',
    'vite.config.ts': "export default { build: { outDir: './release' } };",
    'index.html': '<div id="root"></div>',
  }));
  assert.equal(result.status, 'needs_config');
  assert.equal(result.outputDir, 'release');
  assert.ok(result.diagnostics.some((item) => item.code === 'CUSTOM_OUTPUT_DIR_UNSUPPORTED'));
});

test('ProjectImportAnalyzer blocks secrets before GitHub and reports paths without values', () => {
  const result = analyzer.analyze(files({
    'index.html': '<h1>Hello</h1>',
    '.env': 'API_TOKEN=top-secret',
    'keys/private.pem': '-----BEGIN PRIVATE KEY-----\nnot-a-real-key',
  }));
  assert.equal(result.status, 'needs_config');
  assert.deepEqual(result.secretFindings.map((finding) => finding.path).sort(), ['.env', 'keys/private.pem']);
  assert.ok(result.diagnostics.some((item) => item.code === 'SECRETS_FOUND'));
  assert.ok(!JSON.stringify(result).includes('top-secret'));
});

test('ProjectImportAnalyzer requires explicit root for monorepos and rejects lock conflicts', () => {
  const result = analyzer.analyze(files({
    'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
    'package-lock.json': '{}',
    'pnpm-lock.yaml': 'lockfileVersion: 9',
    'apps/web/package.json': JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '*' } }),
    'apps/web/index.html': '<div id="root"></div>',
  }));
  assert.equal(result.status, 'needs_config');
  assert.equal(result.kind, 'monorepo');
  assert.ok(result.diagnostics.some((item) => item.code === 'MONOREPO_NEEDS_ROOT'));
  assert.ok(result.diagnostics.some((item) => item.code === 'LOCKFILE_CONFLICT'));
});
