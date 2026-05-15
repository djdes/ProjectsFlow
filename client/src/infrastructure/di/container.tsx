import { createContext, useContext, type ReactNode } from 'react';
import { HttpProjectRepository } from '@/infrastructure/http/HttpProjectRepository';
import { HttpUserRepository } from '@/infrastructure/http/HttpUserRepository';
import { HttpAuthRepository } from '@/infrastructure/http/HttpAuthRepository';
import { HttpGithubRepository } from '@/infrastructure/http/HttpGithubRepository';
import { ListProjects } from '@/application/project/ListProjects';
import { GetProject } from '@/application/project/GetProject';
import { CreateProject } from '@/application/project/CreateProject';
import { UpdateProject } from '@/application/project/UpdateProject';
import { GetCurrentUser } from '@/application/user/GetCurrentUser';
import { UpdateProfile } from '@/application/user/UpdateProfile';
import type { AuthRepository } from '@/application/auth/AuthRepository';
import type { GithubRepository } from '@/application/github/GithubRepository';

type Container = {
  listProjects: ListProjects;
  getProject: GetProject;
  createProject: CreateProject;
  updateProject: UpdateProject;
  getCurrentUser: GetCurrentUser;
  updateProfile: UpdateProfile;
  authRepository: AuthRepository;
  githubRepository: GithubRepository;
};

function buildContainer(): Container {
  const projectRepo = new HttpProjectRepository();
  const userRepo = new HttpUserRepository();
  const authRepo = new HttpAuthRepository();
  const githubRepo = new HttpGithubRepository();
  return {
    listProjects: new ListProjects(projectRepo),
    getProject: new GetProject(projectRepo),
    createProject: new CreateProject(projectRepo),
    updateProject: new UpdateProject(projectRepo),
    getCurrentUser: new GetCurrentUser(userRepo),
    updateProfile: new UpdateProfile(userRepo),
    authRepository: authRepo,
    githubRepository: githubRepo,
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
