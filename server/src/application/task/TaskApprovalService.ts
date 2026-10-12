import type { Project } from '../../domain/project/Project.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';

type Deps = {
  readonly workspaces: WorkspaceRepository;
};

// Минимальный контракт, который нужен гейту задачных операций (taskAuthorization): только
// «вправе ли актор принимать работу». Отдельный тип, чтобы не тащить в каждый task-use-case
// зависимости уведомлений — реализуется TaskApprovalService целиком.
export type ApprovalGuard = {
  canApprove(project: Project, actorUserId: string): Promise<boolean>;
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
  async resolveTargetStatus(
    project: Project,
    actorUserId: string,
    requested: TaskStatus,
  ): Promise<TaskStatus> {
    if (requested !== 'done') return requested;
    return (await this.requiresApproval(project, actorUserId)) ? 'pending_approval' : 'done';
  }

  // Вправе ли актор принимать работу в этом пространстве (руководитель/владелец).
  // Отдельно от resolveTargetStatus — нужен там, где решают, показывать ли приёмку.
  async canApprove(project: Project, actorUserId: string): Promise<boolean> {
    const membership = await this.deps.workspaces.getMembership(project.workspaceId, actorUserId);
    // Роли нет вовсе — это admin-bypass (системный админ вне пространства): у него прав
    // больше, чем у участника, поэтому приёмку он не проходит.
    if (!membership) return true;
    return membership.role === 'lead' || membership.role === 'owner';
  }

  private async requiresApproval(project: Project, actorUserId: string): Promise<boolean> {
    // Личные «Входящие» раньше были исключением («свою задачу утверждать не у кого»), но
    // inbox живёт в РАБОЧЕМ пространстве владельца: в командном пространстве у личной задачи
    // руководитель есть, и он же спрашивает за неё результат. Исключение просто прятало от
    // него часть работы. Общее правило справляется само: в личном пространстве владелец —
    // сам себе owner, canApprove=true, приёмки не будет.
    const workspace = await this.deps.workspaces.getById(project.workspaceId);
    if (!workspace?.requireTaskApproval) return false;
    return !(await this.canApprove(project, actorUserId));
  }

}
