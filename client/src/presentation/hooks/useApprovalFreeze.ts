import type { TaskStatus } from '@/domain/task/Task';
import { useWorkspaces } from './useWorkspaces';

// Вправе ли текущий пользователь принимать работу в активном пространстве.
// Зеркалит серверный TaskApprovalService.canApprove: только lead/owner.
export function useCanApproveWork(): boolean {
  const { data: workspaces } = useWorkspaces();
  const current = (workspaces ?? []).find((w) => w.isCurrent) ?? null;
  return current?.role === 'lead' || current?.role === 'owner';
}

// Приёмка (db/150): пока задача ждёт утверждения, менять её вправе только тот, кто принимает
// работу. Сервер гейтит это сам и отвечает 409 `task_awaiting_approval` (см.
// taskAuthorization.assertNotFrozenByApproval), поэтому UI обязан не показывать контролы,
// которые заведомо упадут: исполнитель иначе правит поля, а каждое сохранение откатывается.
export function useApprovalFreeze(status: TaskStatus | null | undefined): boolean {
  const canApprove = useCanApproveWork();
  return status === 'pending_approval' && !canApprove;
}
