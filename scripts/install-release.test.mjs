import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('two releases retain old JS, publish new HTML, prune expired assets and preserve runtime data', () => {
  const target = mkdtempSync(join(tmpdir(), 'pf-release-test-'));
  const write = (base, path, text) => {
    const file = join(base, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const script = fileURLToPath(new URL('./install-release.sh', import.meta.url));
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const install = (version) => {
    const stage = join(target, `.deploy-stage-${version}`);
    for (const file of ['server/dist/index.js', 'scripts/migrate.mjs', 'docs/app-backend-contract.md', 'package.json', 'package-lock.json', 'server/package.json', 'ecosystem.config.cjs']) write(stage, file, version);
    mkdirSync(join(stage, 'db'));
    write(stage, 'client/dist/index.html', `<script src="/assets/${version}-12345678.js"></script>`);
    write(stage, `client/dist/assets/${version}-12345678.js`, version);
    write(stage, 'landing/dist/index.html', version);
    write(stage, `landing/dist/_astro/${version}.12345678.js`, version);
    const result = spawnSync(bash, [script, stage, target].map((p) => p.replaceAll('\\', '/')), { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  };
  try {
    write(target, '.env', 'runtime env stays');
    write(target, 'uploads/user-file', 'runtime upload stays');
    install('old');
    write(target, 'client/dist/assets/expired-12345678.js', 'expired');
    const aged = new Date(Date.now() - 40 * 86400000);
    utimesSync(join(target, 'client/dist/assets/expired-12345678.js'), aged, aged);
    install('new');
    assert.equal(readFileSync(join(target, 'client/dist/assets/old-12345678.js'), 'utf8'), 'old');
    assert.equal(readFileSync(join(target, 'client/dist/assets/new-12345678.js'), 'utf8'), 'new');
    assert.match(readFileSync(join(target, 'client/dist/index.html'), 'utf8'), /new-12345678/);
    assert.ok(existsSync(join(target, 'landing/dist/_astro/old.12345678.js')));
    assert.equal(existsSync(join(target, 'client/dist/assets/expired-12345678.js')), false);
    assert.equal(readFileSync(join(target, '.env'), 'utf8'), 'runtime env stays');
    assert.equal(readFileSync(join(target, 'uploads/user-file'), 'utf8'), 'runtime upload stays');
  } finally {
    assert.ok(resolve(target).startsWith(resolve(tmpdir())) && target.includes('pf-release-test-'));
    rmSync(target, { recursive: true, force: true });
  }
});
