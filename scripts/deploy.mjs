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
// SSH host-key fingerprint для plink/pscp в -batch режиме. Без него на свежей
// машине plink падает с "host key is not cached" (он не читает y/n с пайпа,
// только с controlling terminal). Значение можно перепроверить через:
//   ssh-keyscan -t ed25519 -p 22 projectsflow.ru | ssh-keygen -lf -
const HOSTKEY = process.env.SSH_HOSTKEY ?? "SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E";

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
};

const ssh = (remoteCmd) =>
  run(`plink -ssh -batch -hostkey ${HOSTKEY} -P ${PORT} -pw "${PASS}" ${USER}@${HOST} "${remoteCmd.replace(/"/g, '\\"')}"`);

const scp = (local, remote) =>
  run(`pscp -batch -hostkey ${HOSTKEY} -P ${PORT} -pw "${PASS}" "${local}" ${USER}@${HOST}:"${remote}"`);

console.log("→ 1/4  Build client + landing + server");
run("npm run build");

console.log("→ 2/4  Pack tarball");
const dist = resolve(root, ".deploy");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const releaseName = `release-local-${Date.now()}-${process.pid}.tar.gz`;
const stageName = `.deploy-stage-${releaseName.slice(0, -".tar.gz".length)}`;
const archive = resolve(dist, releaseName);
// Используем tar из Git for Windows (есть в %ProgramFiles%\Git\usr\bin\tar.exe).
// --force-local нужен чтобы GNU tar не интерпретировал "C:" в пути архива
// как remote-host (формат host:path) — иначе деплой из git-bash валится.
//
// ВАЖНО: .env НЕ включаем — он на проде уже лежит с боевыми значениями
// (DB_SOCKET, prod DB_PASSWORD, NODE_ENV=production). Если шиппить локальный
// .env — затрёшь прод-кред и сломаешь подключение к БД. См. docs/ONBOARDING.md §4.
run(
  // docs/app-backend-contract.md — не документация «на почитать», а рантайм-ресурс: сервер
  // вкладывает его в задачу на перевод проекта со своего сервера на бэкенд платформы.
  // Без него воркер получит задачу без контракта и потратит прогон впустую.
  `tar --force-local --exclude=node_modules --exclude=.deploy --exclude=.git -czf "${archive}" server/dist client/dist landing/dist db scripts docs/app-backend-contract.md package.json package-lock.json server/package.json ecosystem.config.cjs`,
);

console.log("→ 3/4  Upload unique release");
ssh(`mkdir -p ${TARGET}`);
scp(archive, `${TARGET}/${releaseName}`);

console.log("→ 4/4  Locked install + migrate + restart");
ssh(
  `cd ${TARGET} && flock -w 900 .deploy.lock bash -c '` +
    `set -euo pipefail; ` +
    `release="$1"; stage="$2"; target="$3"; ` +
    `cleanup() { rm -f "$release"; rm -rf "$stage"; }; trap cleanup EXIT; ` +
    `test -f "$release"; rm -rf "$stage"; mkdir -p "$stage"; ` +
    `tar -xzf "$release" -C "$stage"; ` +
    `bash "$stage/scripts/install-release.sh" "$stage" "$target"; ` +
    `. ~/.nvm/nvm.sh; nvm use 22 >/dev/null; ` +
    `npm ci --omit=dev --no-audit --no-fund; ` +
    `node --env-file=.env scripts/migrate.mjs; ` +
    `pm2 startOrReload ecosystem.config.cjs; pm2 save` +
    `' _ ${releaseName} ${stageName} ${TARGET}`,
);

console.log("\n✓ Deploy complete");
