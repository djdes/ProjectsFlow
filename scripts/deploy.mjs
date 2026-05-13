#!/usr/bin/env node
// Локальный деплой: build → tarball → upload → распаковка → npm i → pm2 restart.
// Требует plink/pscp (PuTTY) в PATH.
// Запуск:  npm run deploy   (загрузит .env автоматически)
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

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
};

const ssh = (remoteCmd) =>
  run(`plink -ssh -batch -P ${PORT} -pw "${PASS}" ${USER}@${HOST} "${remoteCmd.replace(/"/g, '\\"')}"`);

const scp = (local, remote) =>
  run(`pscp -batch -P ${PORT} -pw "${PASS}" "${local}" ${USER}@${HOST}:"${remote}"`);

console.log("→ 1/5  Build client + server");
run("npm run build");

console.log("→ 2/5  Pack tarball");
const dist = resolve(root, ".deploy");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const archive = resolve(dist, "release.tar.gz");
// Используем tar из Git for Windows (есть в %ProgramFiles%\Git\usr\bin\tar.exe)
run(
  `tar --exclude=node_modules --exclude=.deploy --exclude=.git -czf "${archive}" server/dist client/dist db scripts package.json server/package.json ecosystem.config.cjs .env`,
);

console.log("→ 3/5  Upload + extract");
ssh(`mkdir -p ${TARGET}`);
scp(archive, `${TARGET}/release.tar.gz`);
ssh(`cd ${TARGET} && tar -xzf release.tar.gz && rm release.tar.gz`);

console.log("→ 4/5  Install prod deps + migrate");
ssh(
  `cd ${TARGET} && . ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm install --omit=dev --no-audit --no-fund && node --env-file=.env scripts/migrate.mjs`,
);

console.log("→ 5/5  Restart via PM2");
ssh(
  `cd ${TARGET} && . ~/.nvm/nvm.sh && nvm use 22 >/dev/null && pm2 startOrReload ecosystem.config.cjs && pm2 save`,
);

console.log("\n✓ Deploy complete");
