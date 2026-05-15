import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ListProjects } from '../../application/project/ListProjects.js';
import type { GetProject } from '../../application/project/GetProject.js';
import type { CreateProject } from '../../application/project/CreateProject.js';
import type { UpdateProject } from '../../application/project/UpdateProject.js';
import type { ListProjectCommits } from '../../application/github/ListProjectCommits.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createProjectSchema, updateProjectSchema } from './schemas.js';

type Deps = {
  readonly listProjects: ListProjects;
  readonly getProject: GetProject;
  readonly createProject: CreateProject;
  readonly updateProject: UpdateProject;
  readonly listProjectCommits: ListProjectCommits;
};

type ProjectDto = Omit<Project, 'createdAt'> & { createdAt: string };

function toDto(project: Project): ProjectDto {
  return { ...project, createdAt: project.createdAt.toISOString() };
}

type CommitDto = Omit<GithubCommit, 'committedAt'> & { committedAt: string };

function commitToDto(c: GithubCommit): CommitDto {
  return { ...c, committedAt: c.committedAt.toISOString() };
}

export function projectsRouter(deps: Deps): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listProjects.execute(req.user!.id);
      res.json({ projects: list.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const project = await deps.getProject.execute(id, req.user!.id);
      if (!project) throw new ProjectNotFoundError();
      res.json({ project: toDto(project) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id/commits', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const commits = await deps.listProjectCommits.execute(id, req.user!.id);
      res.json({ commits: commits.map(commitToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const project = await deps.createProject.execute({
        ownerId: req.user!.id,
        name: body.name,
      });
      res.status(201).json({ project: toDto(project) });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ProjectNotFoundError();
      const body = updateProjectSchema.parse(req.body);
      const project = await deps.updateProject.execute({
        id,
        ownerId: req.user!.id,
        patch: body,
      });
      res.json({ project: toDto(project) });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
