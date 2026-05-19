// Composition root: собираем зависимости + поднимаем HTTP-сервер.

import { db, pool } from './infrastructure/db/index.js';
import { Argon2PasswordHasher } from './infrastructure/crypto/Argon2PasswordHasher.js';
import { idGenerator } from './infrastructure/id/idGenerator.js';
import { DrizzleUserRepository } from './infrastructure/repositories/DrizzleUserRepository.js';
import { DrizzleSessionRepository } from './infrastructure/repositories/DrizzleSessionRepository.js';
import { DrizzleProjectRepository } from './infrastructure/repositories/DrizzleProjectRepository.js';
import { DrizzleProjectMemberRepository } from './infrastructure/repositories/DrizzleProjectMemberRepository.js';
import { DrizzleProjectInviteRepository } from './infrastructure/repositories/DrizzleProjectInviteRepository.js';
import { DrizzleGithubTokenRepository } from './infrastructure/repositories/DrizzleGithubTokenRepository.js';
import { FetchGithubApiClient } from './infrastructure/github/FetchGithubApiClient.js';
import { DeviceFlowStore } from './infrastructure/github/DeviceFlowStore.js';
import { Register } from './application/auth/Register.js';
import { Login } from './application/auth/Login.js';
import { Logout } from './application/auth/Logout.js';
import { GetCurrentUser } from './application/auth/GetCurrentUser.js';
import { UpdateProfile } from './application/user/UpdateProfile.js';
import { ListProjects } from './application/project/ListProjects.js';
import { GetProject } from './application/project/GetProject.js';
import { CreateProject } from './application/project/CreateProject.js';
import { UpdateProject } from './application/project/UpdateProject.js';
import { GetOrCreateInbox } from './application/project/GetOrCreateInbox.js';
import { ListProjectMembers } from './application/project/ListProjectMembers.js';
import { RemoveProjectMember } from './application/project/RemoveProjectMember.js';
import { UpdateProjectMemberRole } from './application/project/UpdateProjectMemberRole.js';
import { TransferProjectOwnership } from './application/project/TransferProjectOwnership.js';
import { CreateProjectInvite } from './application/project/CreateProjectInvite.js';
import { ListProjectInvites } from './application/project/ListProjectInvites.js';
import { DeleteProjectInvite } from './application/project/DeleteProjectInvite.js';
import { GetInviteByToken } from './application/project/GetInviteByToken.js';
import { AcceptProjectInvite } from './application/project/AcceptProjectInvite.js';
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
import { DrizzleTaskRepository } from './infrastructure/repositories/DrizzleTaskRepository.js';
import { DrizzleTaskCommitRepository } from './infrastructure/repositories/DrizzleTaskCommitRepository.js';
import { DrizzleTaskAttachmentRepository } from './infrastructure/repositories/DrizzleTaskAttachmentRepository.js';
import { DrizzleTaskCommentRepository } from './infrastructure/repositories/DrizzleTaskCommentRepository.js';
import { FileSystemAttachmentStorage } from './infrastructure/storage/FileSystemAttachmentStorage.js';
import { DrizzleAgentTokenRepository } from './infrastructure/repositories/DrizzleAgentTokenRepository.js';
import { Sha256AgentTokenHasher } from './infrastructure/crypto/Sha256AgentTokenHasher.js';
import { CreateAgentToken } from './application/agent/CreateAgentToken.js';
import { ListAgentTokens } from './application/agent/ListAgentTokens.js';
import { RevokeAgentToken } from './application/agent/RevokeAgentToken.js';
import { AuthenticateAgentToken } from './application/agent/AuthenticateAgentToken.js';
import { GetAgentCredential } from './application/agent/GetAgentCredential.js';
import { GetAgentTask } from './application/agent/GetAgentTask.js';
import { CreateAgentCredential } from './application/agent/CreateAgentCredential.js';
import { InMemoryAgentDeviceCodeStore } from './application/agent/AgentDeviceCodeStore.js';
import { RequestAgentDeviceCode } from './application/agent/RequestAgentDeviceCode.js';
import { ApproveAgentDeviceCode } from './application/agent/ApproveAgentDeviceCode.js';
import { PollAgentDeviceToken } from './application/agent/PollAgentDeviceToken.js';
import { GetAgentDeviceCodeInfo } from './application/agent/GetAgentDeviceCodeInfo.js';
import { randomBytes } from 'node:crypto';
import { ListTasks } from './application/task/ListTasks.js';
import { CreateTask } from './application/task/CreateTask.js';
import { UpdateTask } from './application/task/UpdateTask.js';
import { MoveTask } from './application/task/MoveTask.js';
import { DeleteTask } from './application/task/DeleteTask.js';
import { LinkCommit } from './application/task/LinkCommit.js';
import { UnlinkCommit } from './application/task/UnlinkCommit.js';
import { ListTaskCommits } from './application/task/ListTaskCommits.js';
import { SyncTaskCommits } from './application/task/SyncTaskCommits.js';
import { UploadTaskAttachment } from './application/task/UploadTaskAttachment.js';
import { DeleteTaskAttachment } from './application/task/DeleteTaskAttachment.js';
import { ListTaskAttachments } from './application/task/ListTaskAttachments.js';
import { GetTaskAttachment } from './application/task/GetTaskAttachment.js';
import { ListTaskComments } from './application/task/ListTaskComments.js';
import { CreateTaskComment } from './application/task/CreateTaskComment.js';
import { UpdateTaskComment } from './application/task/UpdateTaskComment.js';
import { DeleteTaskComment } from './application/task/DeleteTaskComment.js';
import { DrizzleSecretsRepository } from './infrastructure/repositories/DrizzleSecretsRepository.js';
import { PutSecret } from './application/secrets/PutSecret.js';
import { GetSecret } from './application/secrets/GetSecret.js';
import { DeleteSecret } from './application/secrets/DeleteSecret.js';
import { ListSecretKeys } from './application/secrets/ListSecretKeys.js';
import { createApp } from './presentation/http.js';
import { config, sessionTtlMs } from './presentation/config.js';

const passwordHasher = new Argon2PasswordHasher();
const now = (): Date => new Date();

const userRepo = new DrizzleUserRepository(db);
const sessionRepo = new DrizzleSessionRepository(db);
const projectRepo = new DrizzleProjectRepository(db);
const projectMemberRepo = new DrizzleProjectMemberRepository(db);
const projectInviteRepo = new DrizzleProjectInviteRepository(db);
const githubTokenRepo = new DrizzleGithubTokenRepository(db);

const githubApi = new FetchGithubApiClient(config.github.clientId);
const deviceFlowStore = new DeviceFlowStore();
const kbRepo = new GithubKbRepository(githubApi);

const secretsRepo = new DrizzleSecretsRepository(db);
const taskRepo = new DrizzleTaskRepository(db);
const taskCommitRepo = new DrizzleTaskCommitRepository(db);
const taskAttachmentRepo = new DrizzleTaskAttachmentRepository(db);
const taskCommentRepo = new DrizzleTaskCommentRepository(db);
const agentTokenRepo = new DrizzleAgentTokenRepository(db);

// Каталог с binary-аттачами. В dev: ./uploads (рядом с кодом), в prod: задаём
// UPLOADS_DIR в .env (typically /var/www/.../uploads — снаружи tarball'а деплоя,
// чтобы файлы переживали релизы).
import { resolve as resolvePath } from 'node:path';
const uploadsDir = resolvePath(process.env['UPLOADS_DIR'] ?? 'uploads');
const attachmentStorage = new FileSystemAttachmentStorage(uploadsDir);
console.log(`[projectsflow] attachments dir: ${uploadsDir}`);

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_ATTACHMENT_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const agentTokenHasher = new Sha256AgentTokenHasher();
const agentDeviceCodeStore = new InMemoryAgentDeviceCodeStore();

// Periodic cleanup истёкших pending device-code'ов (10 min TTL → каждые 5 min достаточно).
// Если процесс рестартится — все pending'и теряются, что норм: юзер просто запросит новый.
setInterval(
  () => {
    const pruned = agentDeviceCodeStore.pruneExpired(new Date());
    if (pruned > 0) console.log(`[projectsflow] device-code: pruned ${pruned} expired`);
  },
  5 * 60 * 1000,
).unref();

const authDeps = {
  users: userRepo,
  sessions: sessionRepo,
  passwordHasher,
  idGen: idGenerator,
  sessionTtlMs: sessionTtlMs(),
  now,
};

const { app, devProxyUpgrade } = createApp({
  auth: {
    register: new Register(authDeps),
    login: new Login(authDeps),
    logout: new Logout(sessionRepo),
    getCurrentUser: new GetCurrentUser({ users: userRepo, sessions: sessionRepo, now }),
  },
  user: {
    updateProfile: new UpdateProfile(userRepo),
  },
  projects: {
    listProjects: new ListProjects(projectMemberRepo),
    getProject: new GetProject({ projects: projectRepo, members: projectMemberRepo }),
    createProject: new CreateProject({
      repo: projectRepo,
      members: projectMemberRepo,
      idGen: idGenerator,
    }),
    updateProject: new UpdateProject({ projects: projectRepo, members: projectMemberRepo }),
    listProjectCommits: new ListProjectCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    getOrCreateInbox: new GetOrCreateInbox({
      repo: projectRepo,
      members: projectMemberRepo,
      idGen: idGenerator,
    }),
    listMembers: new ListProjectMembers({ projects: projectRepo, members: projectMemberRepo }),
    removeMember: new RemoveProjectMember({ projects: projectRepo, members: projectMemberRepo }),
    updateMemberRole: new UpdateProjectMemberRole({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    transferOwnership: new TransferProjectOwnership({
      projects: projectRepo,
      members: projectMemberRepo,
    }),
    createInvite: new CreateProjectInvite({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
      idGen: idGenerator,
      randomToken: () => randomBytes(32).toString('hex'),
      now,
      ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 дней (см. spec)
    }),
    listInvites: new ListProjectInvites({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
      now,
    }),
    deleteInvite: new DeleteProjectInvite({
      projects: projectRepo,
      members: projectMemberRepo,
      invites: projectInviteRepo,
    }),
    appUrl: process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173',
  },
  invites: {
    getByToken: new GetInviteByToken({
      invites: projectInviteRepo,
      projects: projectRepo,
      users: userRepo,
      now,
    }),
    accept: new AcceptProjectInvite({
      invites: projectInviteRepo,
      members: projectMemberRepo,
      now,
    }),
  },
  secrets: {
    putSecret: new PutSecret(secretsRepo),
    getSecret: new GetSecret(secretsRepo),
    deleteSecret: new DeleteSecret(secretsRepo),
    listSecretKeys: new ListSecretKeys(secretsRepo),
  },
  kb: {
    initKbRepo: new InitKbRepo({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    connectKbRepo: new ConnectKbRepo({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    disconnectKb: new DisconnectKb({ projects: projectRepo, members: projectMemberRepo }),
    listKbDocuments: new ListKbDocuments({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    getKbDocument: new GetKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    writeKbDocument: new WriteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    deleteKbDocument: new DeleteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    bulkCreateCredential: new BulkCreateCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
      secrets: secretsRepo,
    }),
  },
  tasks: {
    listTasks: new ListTasks({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      attachments: taskAttachmentRepo,
    }),
    createTask: new CreateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      idGen: idGenerator,
    }),
    updateTask: new UpdateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    moveTask: new MoveTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    deleteTask: new DeleteTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    linkCommit: new LinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    unlinkCommit: new UnlinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
    }),
    listTaskCommits: new ListTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
    }),
    syncTaskCommits: new SyncTaskCommits({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    uploadAttachment: new UploadTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
      idGen: idGenerator,
      maxBytes: MAX_ATTACHMENT_BYTES,
      allowedMimeTypes: ALLOWED_ATTACHMENT_MIME,
    }),
    deleteAttachment: new DeleteTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    listAttachments: new ListTaskAttachments({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
    }),
    getAttachment: new GetTaskAttachment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    listComments: new ListTaskComments({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    createComment: new CreateTaskComment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
      idGen: idGenerator,
    }),
    updateComment: new UpdateTaskComment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    deleteComment: new DeleteTaskComment({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      comments: taskCommentRepo,
    }),
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
  },
  agent: {
    createAgentToken: new CreateAgentToken({
      tokens: agentTokenRepo,
      hasher: agentTokenHasher,
      idGen: idGenerator,
      // 32-byte (256-bit) entropy — крипто-случайный токен hex 64 char'а.
      randomToken: () => randomBytes(32).toString('hex'),
    }),
    listAgentTokens: new ListAgentTokens({ tokens: agentTokenRepo }),
    revokeAgentToken: new RevokeAgentToken({ tokens: agentTokenRepo }),
    authenticateAgentToken: new AuthenticateAgentToken({
      tokens: agentTokenRepo,
      hasher: agentTokenHasher,
      users: userRepo,
    }),
    getAgentCredential: new GetAgentCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
      getSecret: new GetSecret(secretsRepo),
    }),
    getAgentTask: new GetAgentTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      attachments: taskAttachmentRepo,
      storage: attachmentStorage,
    }),
    createAgentCredential: new CreateAgentCredential({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
      secrets: secretsRepo,
    }),
    // Переиспользуем существующие use-cases для agent-эндпоинтов
    listProjects: new ListProjects(projectMemberRepo),
    listKbDocuments: new ListKbDocuments({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    listTasks: new ListTasks({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      attachments: taskAttachmentRepo,
    }),
    createTask: new CreateTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      idGen: idGenerator,
    }),
    moveTask: new MoveTask({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
    }),
    linkCommit: new LinkCommit({
      projects: projectRepo,
      members: projectMemberRepo,
      tasks: taskRepo,
      taskCommits: taskCommitRepo,
      tokens: githubTokenRepo,
      api: githubApi,
    }),
    writeKbDocument: new WriteKbDocument({
      projects: projectRepo,
      members: projectMemberRepo,
      tokens: githubTokenRepo,
      kb: kbRepo,
    }),
    requestDeviceCode: new RequestAgentDeviceCode({
      store: agentDeviceCodeStore,
      now,
      ttlMs: 10 * 60 * 1000, // 10 min
      intervalSec: 3,
      // verificationBaseUrl: APP_URL (без '/api'), на проде https://projectsflow.ru.
      // Используем env-vars напрямую — конфиг-объект тут не хочется захламлять,
      // и значение нужно один раз на старте.
      verificationBaseUrl:
        process.env['APP_URL'] ?? process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173',
    }),
    approveDeviceCode: new ApproveAgentDeviceCode({
      store: agentDeviceCodeStore,
      createAgentToken: new CreateAgentToken({
        tokens: agentTokenRepo,
        hasher: agentTokenHasher,
        idGen: idGenerator,
        randomToken: () => randomBytes(32).toString('hex'),
      }),
      now,
    }),
    pollDeviceToken: new PollAgentDeviceToken({ store: agentDeviceCodeStore, now }),
    getDeviceCodeInfo: new GetAgentDeviceCodeInfo({ store: agentDeviceCodeStore, now }),
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

// HMR-WebSocket: Vite-клиент конектится через тот же Express'овый origin.
// Без этого hot-reload не работает через dev-gateway.
if (devProxyUpgrade) {
  server.on('upgrade', devProxyUpgrade);
  console.log('[projectsflow] dev gateway: proxying SPA + HMR to Vite');
}

// Грациозный shutdown — закрываем pool, иначе процесс висит.
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
