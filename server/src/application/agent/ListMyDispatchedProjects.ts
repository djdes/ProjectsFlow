import type { Project } from '../../domain/project/Project.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly agentJobs: AgentJobRepository;
};

export type DispatchedProject = {
  readonly project: Project;
  // Открытые задачи (todo + in_progress) — сколько работы у Ralph'а на этом проекте.
  readonly openTaskCount: number;
  // Queued agent-job'ы по этому проекту (если кто-то нажал «отправить агенту» в UI).
  readonly queuedAgentJobCount: number;
};

// Главный тул для Ralph'а: какие проекты сейчас назначены ему как диспетчеру.
// Возвращает Project + счётчики работы (без самих задач — за ними агент идёт
// отдельно через pf_list_tasks / pf_list_pending_agent_jobs). Это позволяет
// агенту быстро пропустить «пустые» проекты в /loop без N лишних роунд-трипов.
export class ListMyDispatchedProjects {
  constructor(private readonly deps: Deps) {}

  async execute(currentUserId: string): Promise<DispatchedProject[]> {
    const projects = await this.deps.projects.listDispatchedByUser(currentUserId);
    const out: DispatchedProject[] = [];
    for (const p of projects) {
      // Считаем открытые задачи и queued job'ы параллельно. listForProject лимитим
      // в 100 — если у проекта >100 queued job'ов, точная цифра уже не важна, всё
      // равно агент будет работать последовательно.
      const [allTasks, jobs] = await Promise.all([
        this.deps.tasks.listByProject(p.id),
        this.deps.agentJobs.listForProject(p.id, 100),
      ]);
      const openTaskCount = allTasks.filter(
        (t) => t.status === 'todo' || t.status === 'in_progress',
      ).length;
      const queuedAgentJobCount = jobs.filter((j) => j.status === 'queued').length;
      out.push({ project: p, openTaskCount, queuedAgentJobCount });
    }
    return out;
  }
}
