#!/usr/bin/env node
// Прогрев и проверка дискового JSON-кэша промо-страниц и опубликованных досок ProjectsFlow.
// Работает и в production без devDependencies (из server/dist), и локально через tsx.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distEntry = resolve(rootDir, 'server/dist/infrastructure/promo-cache/cliRefresh.js');
const srcEntry = resolve(rootDir, 'server/src/infrastructure/promo-cache/cliRefresh.ts');

const statusOnly = process.argv.includes('--status');

const modUrl = pathToFileURL(existsSync(distEntry) ? distEntry : srcEntry).href;
const mod = await import(modUrl);

if (statusOnly) {
  const status = mod.readPromoCacheStatusOnly();
  console.log(JSON.stringify(status, null, 2));
} else {
  const summary = await mod.runPromoCacheCliRefresh();
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}
