import type { Workspace } from '@/domain/workspace/Workspace';
import { WorkspaceNameEmptyError } from '@/domain/workspace/errors';
import type { WorkspaceRepository } from './WorkspaceRepository';

export class CreateWorkspace {
  constructor(private readonly repo: WorkspaceRepository) {}

  async execute(rawName: string, icon: string | null): Promise<Workspace> {
    const name = rawName.trim();
    if (name.length === 0) throw new WorkspaceNameEmptyError();
    return this.repo.create({ name, icon });
  }
}
