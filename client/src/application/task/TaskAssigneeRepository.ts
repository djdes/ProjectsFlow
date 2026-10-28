import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { AwaitingReplyTask } from '@/domain/task/AwaitingReplyTask';

export interface TaskAssigneeRepository {
  // Все задачи, где caller — текущий обязательный ответственный.
  listMine(): Promise<AssignedTask[]>;
  // То же для другого пространства, где caller — участник («Все входящие»): активное
  // пространство вкладки не меняется. Не участнику сервер отвечает 404.
  listMineInWorkspace(workspaceId: string): Promise<AssignedTask[]>;
  // Все видимые caller'у задачи, где отвечает другой участник.
  listOthers(): Promise<AssignedTask[]>;
  // Личные (inbox) задачи коллег — тех, с кем есть общее рабочее пространство.
  // Только чтение: canModify у таких задач всегда false.
  listColleaguesPersonal(): Promise<AssignedTask[]>;
  // Доска сотрудника для руководителя пространства (BUG D): ВСЕ его незавершённые задачи
  // по всем проектам активного пространства, включая проекты, где сам вызывающий не
  // участник. Сервер гейтит доступ (только lead/owner) — 403/404 в остальных случаях.
  listMemberTasks(memberId: string): Promise<AssignedTask[]>;
  // Очередь приёмки руководителя: все задачи «На утверждении» активного пространства, которые
  // он вправе принять, в том числе поставленные не им. Не руководителю сервер отдаёт пустой список.
  listApprovalQueue(): Promise<AssignedTask[]>;
  // Задачи активного пространства, где мне адресовали комментарий («Кого уведомить» или @),
  // а я ещё не ответил. Новые вопросы сверху; закрытые задачи сервер не отдаёт.
  listAwaitingReply(): Promise<AwaitingReplyTask[]>;
}
