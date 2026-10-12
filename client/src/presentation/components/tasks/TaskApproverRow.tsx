import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import type { WorkspaceMember } from '@/domain/workspace/Workspace';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getInitials } from '@/presentation/layout/projectIcons';
import { PROPERTY_CARET_CLASS, PROPERTY_VALUE_CLASS } from './PropertyRow';

/**
 * Ряд «Кто утверждает» в панели задачи.
 *
 * Поля в модели нет и заводить его не нужно: утверждающий ВЫЧИСЛЯЕТСЯ — это руководители
 * и владелец пространства (TaskApprovalService.canApprove). По нажатию открывается
 * справочный список с именами и ролями. Если приёмка выключена, показываем «Не требуется».
 */
export function TaskApproverRow({ projectId, workspaceId: knownWorkspaceId }: { projectId: string; workspaceId?: string }): React.ReactElement {
  const { workspaceRepository, projectRepository } = useContainer();
  const { data: workspaces } = useWorkspaces();
  const [projectWorkspaceId, setProjectWorkspaceId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setProjectWorkspaceId(knownWorkspaceId ?? null);
    if (knownWorkspaceId) return;
    void projectRepository.getById(projectId).then((p) => {
      if (!cancelled) setProjectWorkspaceId(p?.workspaceId ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectRepository, projectId, knownWorkspaceId]);
  const workspace = (workspaces ?? []).find((w) => projectWorkspaceId ? w.id === projectWorkspaceId : w.isCurrent) ?? null;
  const workspaceId = workspace?.id ?? null;
  const enabled = workspace?.requireTaskApproval ?? false;
  const [approvers, setApprovers] = useState<WorkspaceMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setApprovers(null);
      return;
    }
    let cancelled = false;
    setApprovers(null);
    setFailed(false);
    workspaceRepository
      .listMembers(workspaceId)
      .then((members) => {
        if (cancelled) return;
        setApprovers(members.filter((m) => m.role === 'lead' || m.role === 'owner'));
      })
      // Список — справочная информация; её отсутствие не должно ломать панель задачи.
      .catch(() => {
        if (!cancelled) { setApprovers([]); setFailed(true); }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRepository, workspaceId, enabled, attempt]);

  if (!enabled) return <span className="text-sm text-muted-foreground">Не требуется</span>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className={PROPERTY_VALUE_CLASS} aria-label="Кто утверждает">
          <span className="flex min-w-0 items-center gap-1.5">
            {approvers?.slice(0, 3).map((member) => <ApproverAvatar key={member.userId} member={member} />)}
            {!approvers ? 'Загрузка…' : approvers.length === 0 ? 'Посмотреть' : <span className="truncate">{approvers.length === 1 ? approvers[0].displayName ?? 'Участник' : `${approvers.length} чел.`}</span>}
          </span>
          <ChevronDown className={PROPERTY_CARET_CLASS} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3" aria-label="Кто утверждает">
        <h3 className="mbe-1 text-sm font-semibold">Кто утверждает</h3>
        <p className="mbe-3 text-meta text-muted-foreground">Задачи принимают владелец и руководители пространства.</p>
        {failed ? <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>Не удалось загрузить. Повторить</Button>
          : !approvers ? <p className="text-sm text-muted-foreground">Загрузка…</p>
          : approvers.length === 0 ? <p className="text-sm text-muted-foreground">Нет участников с правом утверждения</p>
          : <ul className="space-y-1">{approvers.map((member) => <li key={member.userId} className="flex min-h-11 items-center gap-3 py-2">
              <ApproverAvatar member={member} />
              <div className="min-w-0">
                <p className="break-words text-sm">{member.displayName ?? member.email ?? 'Участник'}</p>
                <p className="text-meta text-muted-foreground">{member.role === 'owner' ? 'Владелец пространства' : 'Руководитель'}</p>
              </div>
            </li>)}</ul>}
      </PopoverContent>
    </Popover>
  );
}

function ApproverAvatar({ member }: { member: WorkspaceMember }): React.ReactElement {
  const name = member.displayName ?? member.email ?? 'Участник';
  return <Avatar className="size-5 shrink-0 rounded-md">
    {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
    <AvatarFallback className="rounded-md text-2xs">{getInitials(name)}</AvatarFallback>
  </Avatar>;
}
