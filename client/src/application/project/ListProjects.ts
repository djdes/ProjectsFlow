import type { Project } from '@/domain/project/Project';
import type { ProjectRepository } from './ProjectRepository';

export class ListProjects {
  constructor(private readonly repo: ProjectRepository) {}

  execute(): Promise<Project[]> {
    return this.repo.list();
  }

  // Для экрана, который следит за onReadRefreshed: известный список сразу, свежий следом.
  forScreen(options?: { readonly latest?: boolean }): Promise<readonly Project[]> {
    return this.repo.listForScreen(options);
  }

  // Уже известный список — без запроса, для первого кадра.
  peek(): readonly Project[] | null {
    return this.repo.peekList();
  }
}
