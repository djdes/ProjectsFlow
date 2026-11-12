import type { Project } from '../../domain/project/Project.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';

type Deps = {
  readonly workspaces: WorkspaceRepository;
  // Пространства общего проекта (db/182): основное и подключённые. Без него — только основное.
  readonly projectWorkspaceIds?: (projectId: string) => Promise<readonly string[]>;
};

// Минимальный контракт, который нужен гейту задачных операций (taskAuthorization): только
// «вправе ли актор принимать работу». Отдельный тип, чтобы не тащить в каждый task-use-case
// зависимости уведомлений — реализуется TaskApprovalService целиком.
export type ApprovalGuard = {
  canApprove(project: Project, actorUserId: string, originWorkspaceId?: string | null): Promise<boolean>;
};

// Приёмка задач руководителем (db/150, включена по умолчанию с db/151).
//
// Одна политика на все пути закрытия задачи. Раньше гейт жил внутри MoveTask, но задачу
// закрывают и системные потоки (подтверждение close-proposal, авто-закрытие по коммиту,
// «Готово» из Telegram-композера) — они шли мимо, и работа исполнителя утверждение не
// проходила. Теперь решение о статусе принимается здесь, и все вызывают одно и то же.
export class TaskApprovalService {
  constructor(private readonly deps: Deps) {}

  // Какой статус реально записать вместо запрошенного. Подменяем только 'done' и только
  // когда закрывающий не вправе принимать работу сам.
  // originWorkspaceId — пространство, где создана задача общего проекта (db/182): его правило
  // приёмки и его руководители (задачи «Офиса» принимает руководитель «Офиса»).
  async resolveTargetStatus(
    project: Project,
    actorUserId: string,
    requested: TaskStatus,
    originWorkspaceId?: string | null,
  ): Promise<TaskStatus> {
    if (requested !== 'done') return requested;
    return (await this.requiresApproval(project, actorUserId, originWorkspaceId)) ? 'pending_approval' : 'done';
  }

  // Вправе ли актор принимать работу в этом пространстве (руководитель/владелец).
  // Отдельно от resolveTargetStatus — нужен там, где решают, показывать ли приёмку.
  async canApprove(project: Project, actorUserId: string, originWorkspaceId?: string | null): Promise<boolean> {
    const membership = await this.deps.workspaces.getMembership(project.workspaceId, actorUserId);
    // Руководитель основного пространства принимает любые задачи проекта.
    if (membership && (membership.role === 'lead' || membership.role === 'owner')) return true;
    const workspaceIds = (await this.deps.projectWorkspaceIds?.(project.id)) ?? [project.workspaceId];
    const policy = this.policyWorkspace(project, originWorkspaceId, workspaceIds);
    if (policy !== project.workspaceId) {
      const originMembership = await this.deps.workspaces.getMembership(policy, actorUserId);
      if (originMembership) return originMembership.role === 'lead' || originMembership.role === 'owner';
    }
    if (membership) return false;
    // Ни в одном пространстве проекта роли нет — это admin-bypass (системный админ): у него
    // прав больше, чем у участника, поэтому приёмку он не проходит. Гость из подключённого
    // пространства — не админ: без роли руководителя приёмку он не обходит.
    for (const workspaceId of workspaceIds) {
      if (workspaceId !== project.workspaceId && (await this.deps.workspaces.getMembership(workspaceId, actorUserId))) {
        return false;
      }
    }
    return true;
  }

  // Чьё правило приёмки: пространства создания, если оно подключено к проекту, иначе основного.
  private policyWorkspace(
    project: Project,
    originWorkspaceId: string | null | undefined,
    workspaceIds: readonly string[],
  ): string {
    return originWorkspaceId && workspaceIds.includes(originWorkspaceId) ? originWorkspaceId : project.workspaceId;
  }

  private async requiresApproval(
    project: Project,
    actorUserId: string,
    originWorkspaceId?: string | null,
  ): Promise<boolean> {
    // Личные «Входящие» раньше были исключением («свою задачу утверждать не у кого»), но
    // inbox живёт в РАБОЧЕМ пространстве владельца: в командном пространстве у личной задачи
    // руководитель есть, и он же спрашивает за неё результат. Исключение просто прятало от
    // него часть работы. Общее правило справляется само: в личном пространстве владелец —
    // сам себе owner, canApprove=true, приёмки не будет.
    const workspaceIds = (await this.deps.projectWorkspaceIds?.(project.id)) ?? [project.workspaceId];
    const policy = this.policyWorkspace(project, originWorkspaceId, workspaceIds);
    const workspace = await this.deps.workspaces.getById(policy);
    if (!workspace?.requireTaskApproval) return false;
    return !(await this.canApprove(project, actorUserId, originWorkspaceId));
  }

}
