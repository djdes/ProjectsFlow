import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Repair the locally installed MCP contract without publishing a package or touching auth.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.argv[2] || 'C:/www/ralph/mcp-projectsflow.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const server = config.mcpServers?.projectsflow;
const entry = server?.args?.find((arg) => /[\\/]dist[\\/]index\.js$/.test(arg));
if (server?.command !== 'node' || !entry) throw new Error('Expected an explicit local Node MCP entry');
const packageFile = path.resolve(path.dirname(entry), '../package.json');
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
if (pkg.name !== '@projectsflow/mcp-server') throw new Error('Unexpected MCP package');
const domain = fs.readFileSync(path.join(root, 'server/src/domain/task/Task.ts'), 'utf8');
const statusBlock = /export const TASK_STATUSES[^=]*=\s*\[([\s\S]*?)\];/.exec(domain);
const statuses = [...(statusBlock?.[1] || '').matchAll(/'([a-z_0-9]+)'/g)].map((match) => match[1]);
if (!statuses.includes('pending_approval') || statuses.length !== 12) throw new Error('Unexpected task status contract');
const source = fs.readFileSync(entry, 'utf8');
const pattern = /const TASK_STATUS_VALUES = \[([\s\S]*?)\];/;
if (!pattern.test(source)) throw new Error('MCP contract structure changed; inspect before updating');
const next = source.replace(pattern, 'const TASK_STATUS_VALUES = [\n' + statuses.map((status) => `    '${status}',`).join('\n') + '\n];');
if (next === source) {
  console.log(JSON.stringify({ alreadyCurrent: true, version: pkg.version, statuses: statuses.length }));
} else {
  const backup = path.join(path.dirname(configPath), '.runtime/mcp-backups', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(entry, path.join(backup, 'index.js'));
  fs.copyFileSync(packageFile, path.join(backup, 'package.json'));
  const staged = entry + '.worker-update.js';
  fs.writeFileSync(staged, next);
  try {
    execFileSync(process.execPath, ['--check', staged], { stdio: 'pipe' });
    fs.renameSync(staged, entry);
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }
  pkg.version = pkg.version.split('+')[0] + '+pf.worker-statuses';
  fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n');
  console.log(JSON.stringify({ updated: true, version: pkg.version, statuses: statuses.length, approvalSupported: true }));
}
