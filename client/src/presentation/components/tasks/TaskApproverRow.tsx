import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import type { WorkspaceMember } from '@/domain/workspace/Workspace';
import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';

/**
 * Ряд «Утверждающий» в панели задачи.
 *
 * Поля в модели нет и заводить его не нужно: утверждающий ВЫЧИСЛЯЕТСЯ — это руководители
 * и владелец пространства (TaskApprovalService.canApprove). Ряд поэтому read-only и
 * появляется только когда в пространстве включена приёмка: без неё утверждать не у кого,
 * и строка была бы шумом.
 *
 * Возвращает null, когда показывать нечего — вызывающий не решает это за него.
 */
export function TaskApproverRow(): React.ReactElement | null {
  const { workspaceRepository } = useContainer();
  const { data: workspaces } = useWorkspaces();
  const workspace = (workspaces ?? []).find((w) => w.isCurrent) ?? null;
  const workspaceId = workspace?.id ?? null;
  const enabled = workspace?.requireTaskApproval ?? false;
  const [approvers, setApprovers] = useState<WorkspaceMember[] | null>(null);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setApprovers(null);
      return;
    }
    let cancelled = false;
    workspaceRepository
      .listMembers(workspaceId)
      .then((members) => {
        if (cancelled) return;
        setApprovers(members.filter((m) => m.role === 'lead' || m.role === 'owner'));
      })
      // Список — справочная информация; её отсутствие не должно ломать панель задачи.
      .catch(() => {
        if (!cancelled) setApprovers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRepository, workspaceId, enabled]);

  if (!enabled) return null;

  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1.5">
      {approvers === null ? (
        <span className="text-sm text-muted-foreground">…</span>
      ) : approvers.length === 0 ? (
        <span className="text-sm text-muted-foreground">Некому утверждать</span>
      ) : (
        approvers.map((m) => (
          <UserAvatarHover
            key={m.userId}
            displayName={m.displayName ?? m.email ?? '—'}
            avatarUrl={m.avatarUrl}
            subtitle={m.role === 'owner' ? 'владелец пространства' : 'руководитель'}
          />
        ))
      )}
    </div>
  );
}
