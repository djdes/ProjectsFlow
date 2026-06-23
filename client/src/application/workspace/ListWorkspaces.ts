import type { Workspace } from '@/domain/workspace/Workspace';
import type { WorkspaceRepository } from './WorkspaceRepository';

export class ListWorkspaces {
  constructor(private readonly repo: WorkspaceRepository) {}

  execute(): Promise<Workspace[]> {
    return this.repo.list();
  }
}
