import { createContext, useContext, type ReactNode } from 'react';
import { HttpProjectRepository } from '@/infrastructure/http/HttpProjectRepository';
import { HttpUserRepository } from '@/infrastructure/http/HttpUserRepository';
import { HttpAuthRepository } from '@/infrastructure/http/HttpAuthRepository';
import { HttpGithubRepository } from '@/infrastructure/http/HttpGithubRepository';
import { HttpKbRepository } from '@/infrastructure/http/HttpKbRepository';
import { HttpSecretsRepository } from '@/infrastructure/http/HttpSecretsRepository';
import { HttpTaskRepository } from '@/infrastructure/http/HttpTaskRepository';
import { HttpInviteRepository } from '@/infrastructure/http/HttpInviteRepository';
import { HttpNotificationRepository } from '@/infrastructure/http/HttpNotificationRepository';
import { HttpAgentTokenRepository } from '@/infrastructure/http/HttpAgentTokenRepository';
import { HttpAgentDeviceRepository } from '@/infrastructure/http/HttpAgentDeviceRepository';
import { HttpAgentJobRepository } from '@/infrastructure/http/HttpAgentJobRepository';
import { EnqueueAgentJob } from '@/application/agentJob/EnqueueAgentJob';
import { CancelAgentJob } from '@/application/agentJob/CancelAgentJob';
import { ListProjects } from '@/application/project/ListProjects';
import { GetProject } from '@/application/project/GetProject';
import { CreateProject } from '@/application/project/CreateProject';
import { UpdateProject } from '@/application/project/UpdateProject';
import { GetCurrentUser } from '@/application/user/GetCurrentUser';
import { UpdateProfile } from '@/application/user/UpdateProfile';
import type { AuthRepository } from '@/application/auth/AuthRepository';
import type { ProjectRepository } from '@/application/project/ProjectRepository';
import type { GithubRepository } from '@/application/github/GithubRepository';
import type { KbRepository } from '@/application/kb/KbRepository';
import type { SecretsRepository } from '@/application/secrets/SecretsRepository';
import type { TaskRepository } from '@/application/task/TaskRepository';
import type { InviteRepository } from '@/application/project/InviteRepository';
import type { NotificationRepository } from '@/application/notifications/NotificationRepository';
import type { AgentTokenRepository } from '@/application/agent/AgentTokenRepository';
import type { AgentDeviceRepository } from '@/application/agent/AgentDeviceRepository';

type Container = {
  listProjects: ListProjects;
  getProject: GetProject;
  createProject: CreateProject;
  updateProject: UpdateProject;
  getCurrentUser: GetCurrentUser;
  updateProfile: UpdateProfile;
  projectRepository: ProjectRepository;
  authRepository: AuthRepository;
  githubRepository: GithubRepository;
  kbRepository: KbRepository;
  secretsRepository: SecretsRepository;
  taskRepository: TaskRepository;
  inviteRepository: InviteRepository;
  notificationRepository: NotificationRepository;
  agentTokenRepository: AgentTokenRepository;
  agentDeviceRepository: AgentDeviceRepository;
  enqueueAgentJob: EnqueueAgentJob;
  cancelAgentJob: CancelAgentJob;
};

function buildContainer(): Container {
  const projectRepo = new HttpProjectRepository();
  const userRepo = new HttpUserRepository();
  const authRepo = new HttpAuthRepository();
  const githubRepo = new HttpGithubRepository();
  const kbRepo = new HttpKbRepository();
  const secretsRepo = new HttpSecretsRepository();
  const taskRepo = new HttpTaskRepository();
  const inviteRepo = new HttpInviteRepository();
  const notificationRepo = new HttpNotificationRepository();
  const agentTokenRepo = new HttpAgentTokenRepository();
  const agentDeviceRepo = new HttpAgentDeviceRepository();
  const agentJobRepo = new HttpAgentJobRepository();
  return {
    listProjects: new ListProjects(projectRepo),
    getProject: new GetProject(projectRepo),
    createProject: new CreateProject(projectRepo),
    updateProject: new UpdateProject(projectRepo),
    getCurrentUser: new GetCurrentUser(userRepo),
    updateProfile: new UpdateProfile(userRepo),
    projectRepository: projectRepo,
    authRepository: authRepo,
    githubRepository: githubRepo,
    kbRepository: kbRepo,
    secretsRepository: secretsRepo,
    taskRepository: taskRepo,
    inviteRepository: inviteRepo,
    notificationRepository: notificationRepo,
    agentTokenRepository: agentTokenRepo,
    agentDeviceRepository: agentDeviceRepo,
    enqueueAgentJob: new EnqueueAgentJob(agentJobRepo),
    cancelAgentJob: new CancelAgentJob(agentJobRepo),
  };
}

// Module-level singleton.
const container: Container = buildContainer();

const ContainerCtx = createContext<Container | null>(null);

export function ContainerProvider({ children }: { children: ReactNode }): React.ReactElement {
  return <ContainerCtx.Provider value={container}>{children}</ContainerCtx.Provider>;
}

export function useContainer(): Container {
  const c = useContext(ContainerCtx);
  if (!c) throw new Error('useContainer must be used inside <ContainerProvider>');
  return c;
}
