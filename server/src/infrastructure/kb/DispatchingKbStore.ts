import { KbNotConnectedError } from '../../domain/kb/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type {
  KbDeleteInput,
  KbWriteInput,
  ProjectKbStore,
} from '../../application/kb/ProjectKbStore.js';

// Единственная точка ветвления github↔local. Use-case'ы зовут этот стор и не знают про бэкенд.
export class DispatchingKbStore implements ProjectKbStore {
  constructor(
    private readonly deps: { github: ProjectKbStore; local: ProjectKbStore },
  ) {}

  private pick(project: Project): ProjectKbStore {
    if (project.kbKind === 'github') return this.deps.github;
    if (project.kbKind === 'local') return this.deps.local;
    throw new KbNotConnectedError();
  }

  list(project: Project): Promise<KbDocumentSummary[]> {
    return this.pick(project).list(project);
  }
  read(project: Project, path: string): Promise<KbDocument | null> {
    return this.pick(project).read(project, path);
  }
  write(project: Project, input: KbWriteInput): Promise<{ sha: string }> {
    return this.pick(project).write(project, input);
  }
  delete(project: Project, input: KbDeleteInput): Promise<void> {
    return this.pick(project).delete(project, input);
  }
}
