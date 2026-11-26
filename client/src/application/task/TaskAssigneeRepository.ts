import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { AwaitingReplyTask } from '@/domain/task/AwaitingReplyTask';
import type { InboxOverview } from '@/domain/task/InboxOverview';

export interface TaskAssigneeRepository {
  // Задачи, где caller — текущий обязательный ответственный, в другом пространстве, где он
  // участник («Все входящие»): активное пространство вкладки не меняется. Не участнику сервер
  // отвечает 404. В своём пространстве этот список приходит в loadInboxOverview.
  listMineInWorkspace(workspaceId: string): Promise<AssignedTask[]>;
  // All readable tasks assigned to others in an explicit workspace, without switching it.
  listOthersInWorkspace(workspaceId: string): Promise<AssignedTask[]>;
  // Доска сотрудника для руководителя пространства (BUG D): ВСЕ его незавершённые задачи
  // по всем проектам активного пространства, включая проекты, где сам вызывающий не
  // участник. Сервер гейтит доступ (только lead/owner) — 403/404 в остальных случаях.
  listMemberTasks(memberId: string): Promise<AssignedTask[]>;
  // Задачи активного пространства, где мне адресовали комментарий («Кого уведомить» или @),
  // а я ещё не ответил. Новые вопросы сверху; закрытые задачи сервер не отдаёт.
  listAwaitingReply(): Promise<AwaitingReplyTask[]>;
  // Всё для «Входящих» одним запросом: мои задачи; задачи других участников; личные (inbox)
  // задачи коллег по общим пространствам (только чтение, canModify — false); очередь приёмки
  // руководителя («На утверждении», не руководителю — пусто); вопросы ко мне без ответа. Повторный визит получает известное сразу, а свежее подгружается следом: о нём
  // сообщает onReadRefreshed (lib/readRefreshed) — экран перечитывает, уже из памяти.
  // latest — дождаться актуального (обновление жестом, после своих правок, по событию).
  // excludeDone — не тянуть историю выполненных задач, пока в UI включено «Скрыть выполненные».
  // Пока ответ не менялся, отдаёт те же объекты (React не перерисовывает); не изменять их.
  loadInboxOverview(options?: { readonly latest?: boolean; readonly excludeDone?: boolean }): Promise<InboxOverview>;
  // Что об обзоре уже известно — без запроса, для первого кадра; null — пока ничего.
  peekInboxOverview(options?: { readonly excludeDone?: boolean }): InboxOverview | null;
}
