import type { Project } from '../../domain/project/Project.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { AiPromptJobRepository } from '../ai-prompt/AiPromptJobRepository.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly aiPromptJobs: AiPromptJobRepository;
  readonly automation: AutomationRepository;
};

export type DispatchedProject = {
  readonly project: Project;
  // Открытые задачи (todo + in_progress) — сколько работы у Ralph'а на этом проекте.
  readonly openTaskCount: number;
  // Queued AI-prompt-job'ы по этому проекту (новый тип short-lived job'ов от сайта).
  // См. spec 2026-05-28-ai-prompt-improvement-design.md.
  readonly pendingAiPromptJobCount: number;
  // Включена ли автоматизация (project_automation.enabled). Диспетчер по этому флагу
  // решает, опрашивать ли полный конфиг GET'ом /automation. См. план virtual-exploring-pascal.md.
  readonly automationEnabled: boolean;
};

// Главный тул для Ralph'а: какие проекты сейчас назначены ему как диспетчеру.
// Возвращает Project + счётчики работы (без самих задач — за ними агент идёт
// отдельно через pf_list_tasks / pf_list_pending_agent_jobs). Это позволяет
// агенту быстро пропустить «пустые» проекты в /loop без N лишних роунд-трипов.
export class ListMyDispatchedProjects {
  constructor(private readonly deps: Deps) {}

  async execute(currentUserId: string): Promise<DispatchedProject[]> {
    const projects = await this.deps.projects.listDispatchedByUser(currentUserId);
    // Заранее считаем AI-prompt-job'ы одним запросом для всех проектов, чтобы не
    // делать N+1. Map: projectId → count. Inbox-job'ы (projectId=null) не показываются
    // в per-project счётчиках — Ralph поллит их через pf_list_pending_ai_prompt_jobs.
    const aiCountRows = await this.deps.aiPromptJobs.countPendingByProjectForDispatcher(
      currentUserId,
    );
    const aiCountByProject = new Map<string, number>();
    for (const row of aiCountRows) {
      if (row.projectId !== null) aiCountByProject.set(row.projectId, row.count);
    }

    // Один запрос на все проекты с включённой автоматизацией.
    const automationEnabledIds = new Set(await this.deps.automation.listEnabledProjectIds());

    const out: DispatchedProject[] = [];
    for (const p of projects) {
      const allTasks = await this.deps.tasks.listByProject(p.id);
      // «Открытые» = задачи, которые ждут работы или активно делаются:
      // todo / in_progress / awaiting_clarification. Backlog (триаж), done
      // (закрыта) и manual (отдельная ветка для человека) — исключены.
      const openTaskCount = allTasks.filter(
        (t) =>
          t.status === 'todo' ||
          t.status === 'in_progress' ||
          t.status === 'awaiting_clarification',
      ).length;
      const pendingAiPromptJobCount = aiCountByProject.get(p.id) ?? 0;
      out.push({
        project: p,
        openTaskCount,
        pendingAiPromptJobCount,
        automationEnabled: automationEnabledIds.has(p.id),
      });
    }
    return out;
  }
}
