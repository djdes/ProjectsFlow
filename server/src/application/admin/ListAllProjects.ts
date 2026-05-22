import type { AdminProjectView, AdminRepository } from './AdminRepository.js';

export class ListAllProjects {
  constructor(private readonly repo: AdminRepository) {}

  execute(): Promise<AdminProjectView[]> {
    return this.repo.listAllProjects();
  }
}
