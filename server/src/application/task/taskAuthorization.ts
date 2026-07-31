import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectAction } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskRepository } from './TaskRepository.js';
import type { ApprovalGuard } from './TaskApprovalService.js';
import { TaskAwaitingApprovalError } from '../../domain/task/errors.js';

export type TaskAccessDeps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
};

// Зависимости МУТИРУЮЩИХ операций: сверх чтения нужна политика приёмки — задача в очереди
// утверждения заморожена для всех, кроме принимающего (db/150). Обязательна намеренно:
// опциональная зависимость означала бы «часть use-case'ов тихо не проверяет правило», а
// такие дыры не видны на ревью. Read-хелперы её не требуют — им нечего запрещать.
export type TaskModifyAccessDeps = TaskAccessDeps & {
  readonly approval: ApprovalGuard;
};

// Действия, запрещённые пока задача ждёт приёмки. Чтение НЕ здесь: тред и историю версий
// исполнителю видно — заморожена правка, не просмотр.
const FROZEN_WHILE_AWAITING_APPROVAL: readonly ProjectAction[] = [
  'update_task',
  'move_task',
  'assign_task',
  'manage_attachments',
  // Удаление — тоже изменение, причём необратимее прочих: пока работа висит на утверждении,
  // исполнитель не должен убирать её из очереди руководителя (мягкое, но из очереди уходит).
  'delete_task',
  // Тред — часть задачи, поэтому по требованию владельца он тоже заморожен: пока работа на
  // утверждении, исполнитель не дописывает и не переписывает обсуждение, которое читает
  // руководитель. Раньше комментарии были намеренно открыты («отвечать на замечания»), но
  // на практике это давало исполнителю возможность менять принимаемое.
  'create_comment',
  'update_own_comment',
  'delete_own_comment',
  'delete_any_comment',
];

/**
 * Единый гейт заморозки: задача в очереди утверждения неприкосновенна для всех, кроме того,
 * кто эту работу принимает (db/150).
 *
 * Вынесен из requireTaskModifyAccess, потому что часть путей ходит мимо него со своей
 * авторизацией — перенос в другой проект и удаление. Правило должно быть ОДНО: раньше эти
 * два пути гейта не знали, и задача на утверждении спокойно уезжала в другой проект или
 * в корзину руками исполнителя.
 */
export async function assertNotFrozenByApproval(
  approval: ApprovalGuard,
  project: Project,
  task: Pick<Task, 'status'>,
  userId: string,
  action: ProjectAction,
): Promise<void> {
  if (task.status !== 'pending_approval') return;
  if (!FROZEN_WHILE_AWAITING_APPROVAL.includes(action)) return;
  if (await approval.canApprove(project, userId)) return;
  throw new TaskAwaitingApprovalError();
}

export type TaskAccessResult = {
  readonly project: Project;
  // true когда caller — текущий ответственный (независимо от creator/owner).
  readonly isAssignee: boolean;
};

/**
 * Коллега по общему пространству — тот, кто и так ВИДИТ личные задачи этого владельца.
 *
 * Граница ровно та же, что у видимости (ListPersonalTasksOfColleagues → listSharedUsers):
 * участники общих с caller'ом пространств. Раньше личные задачи коллег было видно, но нельзя
 * было ни перевести в другую колонку, ни удалить — карточка выглядела живой, а действия
 * молча упирались в 404. Теперь право на действие совпадает с правом на просмотр.
 *
 * Шире не открываем: посторонний (нет общего пространства) не увидит задачу и не тронет её —
 * список коллег формирует сервер, клиент не передаёт ни одного id.
 */
async function isInboxColleague(
  deps: TaskAccessDeps,
  userId: string,
  inboxOwnerId: string,
): Promise<boolean> {
  if (userId === inboxOwnerId) return true;
  const colleagues = await deps.members.listSharedUsers(userId);
  return colleagues.some((c) => c.id === inboxOwnerId);
}

// Assignee-aware authorization для task-modify операций.
// Для inbox разрешён owner или текущий ответственный. В именованном проекте editor+
// сохраняет обычные права, а назначенный viewer получает task-scoped update/move.
//
// 404 (ProjectNotFoundError) когда caller не участник и не текущий ответственный —
// семантика «не палим существование» (как в requireProjectAccess).
export async function requireTaskModifyAccess(
  deps: TaskModifyAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
  action: ProjectAction,
  // Отзыв работы из очереди приёмки самим исполнителем: он не ПРАВИТ задачу, а забирает
  // её из очереди целиком, поэтому смысл заморозки («руководитель принимает то, что
  // видел») не нарушается. Условия проверяет вызывающий (MoveTask), здесь только флаг —
  // так исключение остаётся в одном месте и его видно на ревью.
  opts?: { readonly skipApprovalFreeze?: boolean },
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();
  const task = await deps.tasks.getById(taskId);
  if (!task || task.projectId !== projectId) throw new ProjectNotFoundError();

  // Заморозка на время приёмки. Проверяем ДО ролевых веток: правило одинаково и для
  // именованного проекта, и для inbox, и для назначенного viewer'а — пока работа висит на
  // утверждении, менять её вправе только тот, кто эту работу принимает.
  if (!opts?.skipApprovalFreeze) {
    await assertNotFrozenByApproval(deps.approval, project, task, userId, action);
  }

  if (project.isInbox) {
    if (project.ownerId === userId) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (task.assignee.userId === userId) {
      return { project, isAssignee: true };
    }
    // Коллега по общему пространству: он эту задачу видит во «Входящих», значит может и
    // перевести её в другую колонку.
    if (await isInboxColleague(deps, userId, project.ownerId)) {
      return { project, isAssignee: false };
    }
    throw new ProjectNotFoundError();
  }

  if (task.assignee.userId === userId) {
    // Назначение не раскрывает проект постороннему: хотя бы viewer-membership обязателен.
    await requireProjectAccess(deps, projectId, userId, 'read_project');
    return { project, isAssignee: true };
  }
  await requireProjectAccess(deps, projectId, userId, action);
  return { project, isAssignee: false };
}

// Read-операции (комментарии, вложения, коммиты) — та же inbox-aware семантика, что и
// modify: для inbox разрешён owner ИЛИ assignee, для именованного проекта —
// обычный requireProjectAccess('read_project'). Ответственный личной задачи не состоит в
// приватном Inbox-проекте владельца, поэтому получает доступ именно через assignee.
export async function requireTaskReadAccess(
  deps: TaskAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();
  const task = await deps.tasks.getById(taskId);
  if (!task || task.projectId !== projectId) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (project.ownerId === userId) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (task.assignee.userId === userId) return { project, isAssignee: true };
    // Тот же круг, что и для правки: раз задача видна в списке, карточку надо уметь открыть.
    // Иначе получилось бы полуфункциональное состояние — статус меняется, а по клику 404.
    if (await isInboxColleague(deps, userId, project.ownerId)) {
      return { project, isAssignee: false };
    }
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, 'read_project');
  return { project, isAssignee: task.assignee.userId === userId };
}

// Delete-операции для inbox-задач: владелец Inbox или коллега по общему пространству.
// Текущий ответственный сам по себе права на удаление НЕ получает — если он не коллега
// владельца, задача ему делегирована извне, и убирать её из чужих «Входящих» он не должен.
// Удаление мягкое (deleted_at, db/134), поэтому ошибочное действие восстановимо.
export async function requireTaskDeleteAccess(
  deps: TaskAccessDeps,
  projectId: string,
  userId: string,
  action: ProjectAction,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (await isInboxColleague(deps, userId, project.ownerId)) {
      return { project, isAssignee: false };
    }
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, action);
  return { project, isAssignee: false };
}
