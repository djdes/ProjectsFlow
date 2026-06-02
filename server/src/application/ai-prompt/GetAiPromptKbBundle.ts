import {
  AiPromptJobNotFoundError,
  NotDispatcherForAiPromptJobError,
} from '../../domain/ai-prompt/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ListKbDocuments } from '../kb/ListKbDocuments.js';
import type { GetKbDocument } from '../kb/GetKbDocument.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';
import { prepareKbContext } from './prepareKbContext.js';

// Сколько проектов максимум обслуживаем за один запрос (ralph шлёт только реально
// задетектированные в pass-1 проекты — обычно 1-4).
const MAX_PROJECTS = 10;

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
};

export type AiPromptKbBundle = {
  readonly projectId: string;
  readonly name: string;
  readonly kb: string | null;
};

/**
 * Отдаёт ПОЛНУЮ KB задетектированных проектов для compose-pass-2 («Продвинутый»).
 * Вызывается диспетчером (ralph) МЕЖДУ двумя проходами Claude.
 *
 * Безопасность:
 *  - caller обязан быть диспетчером именно этого job'а (job.dispatcherUserId === userId);
 *  - KB читается ОТ ИМЕНИ создателя job'а (job.createdBy), а не диспетчера — корректно
 *    для admin-диспетчера, который сам не member чужих проектов; requireProjectAccess
 *    гарантирует, что у создателя есть доступ к каждому запрошенному проекту.
 * Best-effort: проект без доступа/KB просто пропускается.
 */
export class GetAiPromptKbBundle {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    userId: string;
    jobId: string;
    projectIds: readonly string[];
  }): Promise<{ bundles: AiPromptKbBundle[] }> {
    const job = await this.deps.aiPromptJobs.findById(input.jobId);
    if (!job) throw new AiPromptJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForAiPromptJobError(input.jobId);
    }

    const ids = [...new Set(input.projectIds)].slice(0, MAX_PROJECTS);
    const bundles: AiPromptKbBundle[] = [];
    for (const pid of ids) {
      try {
        const { project } = await requireProjectAccess(this.deps, pid, job.createdBy, 'read_project');
        const kb = await prepareKbContext(project, job.createdBy, this.deps);
        bundles.push({ projectId: pid, name: project.name, kb });
      } catch {
        // best-effort: нет доступа / KB не подключена / ошибка чтения — пропускаем проект.
      }
    }
    return { bundles };
  }
}
