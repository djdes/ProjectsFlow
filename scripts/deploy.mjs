#!/usr/bin/env node
// Локальный деплой: build (client + server + landing) → tarball → upload → распаковка
// → npm i → миграции → pm2 reload. Требует plink/pscp (PuTTY) в PATH.
//
// Раскладка на сервере после деплоя:
//   $DEPLOY_PATH/                — Node-приложение (server/dist + client/dist раздаётся nginx'ом
//                                  на app.projectsflow.ru, либо Express'ом — настраиваемо)
//   $LANDING_DEPLOY_PATH/        — статика лендинга (dist), nginx раздаёт на projectsflow.ru/
//
// .env на сервере НЕ перезаписывается деплоем — там лежат прод-значения (SMTP, DB_SOCKET, etc.).

import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const req = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Missing env: ${name}. Запусти через npm run deploy.`);
    process.exit(1);
  }
  return v;
};

const HOST = req("SSH_HOST");
const PORT = process.env.SSH_PORT_LOCAL ?? "22";
const USER = req("SSH_USER");
const PASS = req("SSH_PASSWORD");
const TARGET = req("DEPLOY_PATH");
const LANDING_TARGET = process.env.LANDING_DEPLOY_PATH ?? `${TARGET}/landing`;

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
};

const ssh = (remoteCmd) =>
  run(`plink -ssh -batch -P ${PORT} -pw "${PASS}" ${USER}@${HOST} "${remoteCmd.replace(/"/g, '\\"')}"`);

const scp = (local, remote) =>
  run(`pscp -batch -P ${PORT} -pw "${PASS}" "${local}" ${USER}@${HOST}:"${remote}"`);

console.log("→ 1/6  Build client + server + landing");
run("npm run build");

console.log("→ 2/6  Pack app tarball (server + client SPA + db + scripts)");
const dist = resolve(root, ".deploy");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const appArchive = resolve(dist, "app.tar.gz");
run(
  `tar --exclude=node_modules --exclude=.deploy --exclude=.git -czf "${appArchive}" server/dist client/dist db scripts package.json server/package.json ecosystem.config.cjs .env`,
);

console.log("→ 3/6  Pack landing tarball");
const landingArchive = resolve(dist, "landing.tar.gz");
run(`tar -czf "${landingArchive}" -C landing/dist .`);

console.log("→ 4/6  Upload + extract");
ssh(`mkdir -p ${TARGET} ${LANDING_TARGET}`);
scp(appArchive, `${TARGET}/app.tar.gz`);
scp(landingArchive, `${LANDING_TARGET}/landing.tar.gz`);
ssh(`cd ${TARGET} && tar -xzf app.tar.gz && rm app.tar.gz`);
ssh(`cd ${LANDING_TARGET} && tar -xzf landing.tar.gz && rm landing.tar.gz`);

console.log("→ 5/6  Install prod deps + migrate");
ssh(
  `cd ${TARGET} && . ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm install --omit=dev --no-audit --no-fund && node --env-file=.env scripts/migrate.mjs`,
);

console.log("→ 6/6  Restart via PM2");
ssh(
  `cd ${TARGET} && . ~/.nvm/nvm.sh && nvm use 22 >/dev/null && pm2 startOrReload ecosystem.config.cjs && pm2 save`,
);

console.log("\n✓ Deploy complete");
console.log(`  app:     https://app.projectsflow.ru/  (Node на 127.0.0.1:4317)`);
console.log(`  landing: https://projectsflow.ru/      (статика из ${LANDING_TARGET})`);
