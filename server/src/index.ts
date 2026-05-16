// Composition root: собираем зависимости + поднимаем HTTP-сервер.

import { db, pool } from './infrastructure/db/index.js';
import { idGenerator } from './infrastructure/id/idGenerator.js';
import { DrizzleUserRepository } from './infrastructure/repositories/DrizzleUserRepository.js';
import { DrizzleSessionRepository } from './infrastructure/repositories/DrizzleSessionRepository.js';
import { DrizzleProjectRepository } from './infrastructure/repositories/DrizzleProjectRepository.js';
import { DrizzleGithubTokenRepository } from './infrastructure/repositories/DrizzleGithubTokenRepository.js';
import { DrizzleMagicTokenRepository } from './infrastructure/repositories/DrizzleMagicTokenRepository.js';
import { FetchGithubApiClient } from './infrastructure/github/FetchGithubApiClient.js';
import { DeviceFlowStore } from './infrastructure/github/DeviceFlowStore.js';
import { NodemailerEmailSender } from './infrastructure/email/NodemailerEmailSender.js';
import { ConsoleEmailSender } from './infrastructure/email/ConsoleEmailSender.js';
import type { EmailSender } from './application/email/EmailSender.js';
import { RequestMagicLink } from './application/auth/RequestMagicLink.js';
import { ConsumeMagicLink } from './application/auth/ConsumeMagicLink.js';
import { Logout } from './application/auth/Logout.js';
import { GetCurrentUser } from './application/auth/GetCurrentUser.js';
import { UpdateProfile } from './application/user/UpdateProfile.js';
import { ListProjects } from './application/project/ListProjects.js';
import { GetProject } from './application/project/GetProject.js';
import { CreateProject } from './application/project/CreateProject.js';
import { UpdateProject } from './application/project/UpdateProject.js';
import { StartDeviceFlow } from './application/github/StartDeviceFlow.js';
import { PollDeviceFlow } from './application/github/PollDeviceFlow.js';
import { DisconnectGithub } from './application/github/DisconnectGithub.js';
import { ListUserRepos } from './application/github/ListUserRepos.js';
import { ListProjectCommits } from './application/github/ListProjectCommits.js';
import { GithubKbRepository } from './infrastructure/kb/GithubKbRepository.js';
import { InitKbRepo } from './application/kb/InitKbRepo.js';
import { ConnectKbRepo } from './application/kb/ConnectKbRepo.js';
import { DisconnectKb } from './application/kb/DisconnectKb.js';
import { ListKbDocuments } from './application/kb/ListKbDocuments.js';
import { GetKbDocument } from './application/kb/GetKbDocument.js';
import { WriteKbDocument } from './application/kb/WriteKbDocument.js';
import { DeleteKbDocument } from './application/kb/DeleteKbDocument.js';
import { BulkCreateCredential } from './application/kb/BulkCreateCredential.js';
import { AesGcmSecretCipher } from './infrastructure/crypto/AesGcmSecretCipher.js';
import { DrizzleSecretsRepository } from './infrastructure/repositories/DrizzleSecretsRepository.js';
import { PutSecret } from './application/secrets/PutSecret.js';
import { GetSecret } from './application/secrets/GetSecret.js';
import { DeleteSecret } from './application/secrets/DeleteSecret.js';
import { ListSecretKeys } from './application/secrets/ListSecretKeys.js';
import type { SecretsCipher } from './application/secrets/SecretsCipher.js';
import { SecretsVaultDisabledError } from './domain/secrets/errors.js';
import { createApp } from './presentation/http.js';
import {
  config,
  isProd,
  magicRateLimitWindowMs,
  magicTokenTtlMs,
  sessionTtlMs,
} from './presentation/config.js';

const now = (): Date => new Date();

const userRepo = new DrizzleUserRepository(db);
const sessionRepo = new DrizzleSessionRepository(db);
const magicTokenRepo = new DrizzleMagicTokenRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const githubTokenRepo = new DrizzleGithubTokenRepository(db);

const githubApi = new FetchGithubApiClient(config.github.clientId);
const deviceFlowStore = new DeviceFlowStore();
const kbRepo = new GithubKbRepository(githubApi);

let emailSender: EmailSender;
if (config.smtp) {
  emailSender = new NodemailerEmailSender(config.smtp);
  console.log(`[projectsflow] email: SMTP via ${config.smtp.host}:${config.smtp.port}`);
} else {
  if (isProd()) {
    throw new Error('SMTP не настроен. В prod нужны SMTP_HOST/PORT/USER/PASS/FROM.');
  }
  emailSender = new ConsoleEmailSender();
  console.warn('[projectsflow] email: ConsoleEmailSender (dev). Magic link напечатается в логе.');
}

let secretsCipher: AesGcmSecretCipher | null = null;
try {
  secretsCipher = new AesGcmSecretCipher(config.secrets.masterKey);
  console.log('[projectsflow] secrets vault: enabled');
} catch {
  console.warn('[projectsflow] secrets vault: DISABLED (set SECRETS_MASTER_KEY)');
}

const secretsRepo = new DrizzleSecretsRepository(db);
const stubCipher: SecretsCipher = {
  encrypt: () => { throw new SecretsVaultDisabledError(); },
  decrypt: () => { throw new SecretsVaultDisabledError(); },
};
const activeCipher = secretsCipher ?? stubCipher;

const app = createApp({
  auth: {
    requestMagicLink: new RequestMagicLink({
      tokens: magicTokenRepo,
      email: emailSender,
      idGen: idGenerator,
      now,
      tokenTtlMs: magicTokenTtlMs(),
      rateLimitWindowMs: magicRateLimitWindowMs(),
      rateLimitMax: config.magic.rateLimitMax,
      appUrl: config.appUrl,
      fromName: config.brandName,
    }),
    consumeMagicLink: new ConsumeMagicLink({
      tokens: magicTokenRepo,
      users: userRepo,
      sessions: sessionRepo,
      idGen: idGenerator,
      sessionTtlMs: sessionTtlMs(),
      now,
    }),
    logout: new Logout(sessionRepo),
    getCurrentUser: new GetCurrentUser({ users: userRepo, sessions: sessionRepo, now }),
  },
  user: {
    updateProfile: new UpdateProfile(userRepo),
  },
  projects: {
    listProjects: new ListProjects(projectRepo),
    getProject: new GetProject(projectRepo),
    createProject: new CreateProject({ repo: projectRepo, idGen: idGenerator }),
    updateProject: new UpdateProject(projectRepo),
    listProjectCommits: new ListProjectCommits({
      projects: projectRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
  },
  secrets: {
    putSecret: new PutSecret(secretsRepo, activeCipher),
    getSecret: new GetSecret(secretsRepo, activeCipher),
    deleteSecret: new DeleteSecret(secretsRepo),
    listSecretKeys: new ListSecretKeys(secretsRepo),
  },
  kb: {
    initKbRepo: new InitKbRepo({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
    connectKbRepo: new ConnectKbRepo({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
    disconnectKb: new DisconnectKb(projectRepo),
    listKbDocuments: new ListKbDocuments({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
    getKbDocument: new GetKbDocument({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
    writeKbDocument: new WriteKbDocument({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
    deleteKbDocument: new DeleteKbDocument({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
    bulkCreateCredential: new BulkCreateCredential({
      projects: projectRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
      secrets: secretsRepo,
      cipher: activeCipher,
    }),
  },
  github: {
    startDeviceFlow: new StartDeviceFlow({
      api: githubApi,
      storeDeviceCode: (userId, deviceCode, interval, expiresAt) =>
        deviceFlowStore.store(userId, deviceCode, interval, expiresAt),
      now,
    }),
    pollDeviceFlow: new PollDeviceFlow({
      api: githubApi,
      tokens: githubTokenRepo,
      getDeviceCode: (userId) => deviceFlowStore.get(userId),
      updateInterval: (userId, ms) => deviceFlowStore.setInterval(userId, ms),
      clearDeviceCode: (userId) => deviceFlowStore.clear(userId),
      now,
    }),
    disconnectGithub: new DisconnectGithub(githubTokenRepo),
    listUserRepos: new ListUserRepos({ tokens: githubTokenRepo, api: githubApi }),
    tokens: githubTokenRepo,
  },
});

const server = app.listen(config.port, () => {
  console.log(
    `[projectsflow] listening on http://127.0.0.1:${config.port} (${config.nodeEnv})`,
  );
  console.log(
    `[projectsflow] github integration: ${config.github.clientId ? 'enabled' : 'DISABLED (no GITHUB_CLIENT_ID)'}`,
  );
});

const shutdown = (signal: string): void => {
  console.log(`[projectsflow] received ${signal}, shutting down`);
  server.close(() => {
    pool.end().then(() => {
      console.log('[projectsflow] pool closed, bye');
      process.exit(0);
    });
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
