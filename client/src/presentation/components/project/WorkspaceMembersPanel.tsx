import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, LockKeyhole, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';
import { WORKSPACE_ROLE_LABEL, type Workspace, type WorkspaceMember, type WorkspaceRole } from '@/domain/workspace/Workspace';
import type { WorkspaceProjectAccess } from '@/domain/workspace/WorkspaceProjectAccess';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useWorkspacesContext } from '@/presentation/hooks/WorkspacesProvider';
import { PROJECT_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { ProjectAccessChecklist } from './ProjectAccessChecklist';
import { WorkspaceInviteForm } from './WorkspaceInviteForm';

export function WorkspaceMembersPanel({ workspace, projectId, manageRoles = false }: {
  workspace: Workspace;
  projectId?: string;
  manageRoles?: boolean;
}): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const { user } = useCurrentUser();
  const { refresh } = useWorkspacesContext();
  const [data, setData] = useState<{ members: WorkspaceMember[]; access: WorkspaceProjectAccess } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const mounted = useRef(true);
  const canManage = workspace.kind !== 'default' && (workspace.role === 'owner' || workspace.role === 'lead');
  const reload = useCallback(async () => {
    const current = ++seq.current;
    try {
      const [members, access] = await Promise.all([
        workspaceRepository.listMembers(workspace.id), workspaceRepository.getProjectAccess(workspace.id),
      ]);
      if (mounted.current && current === seq.current) { setData({ members, access }); setError(null); }
    } catch (failure) {
      if (mounted.current && current === seq.current) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить участников');
    }
  }, [workspace.id, workspaceRepository]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const changed = (): void => { void reload(); };
    window.addEventListener(PROJECT_CHANGED_EVENT, changed);
    return () => { mounted.current = false; window.removeEventListener(PROJECT_CHANGED_EVENT, changed); };
  }, [reload]);

  const updateAccess = async (memberId: string, id: string, visible: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setSaving(memberId);
    const previous = data;
    setData((current) => current && ({ ...current, access: { ...current.access, members: current.access.members.map((member) => member.userId !== memberId ? member : {
      ...member, hiddenProjectIds: visible ? member.hiddenProjectIds.filter((project) => project !== id) : [...new Set([...member.hiddenProjectIds, id])],
    }) } }));
    try {
      await workspaceRepository.setProjectAccess(workspace.id, id, memberId, visible);
      await reload();
      refresh();
      window.dispatchEvent(new CustomEvent(PROJECT_CHANGED_EVENT, { detail: { projectId: id } }));
      toast.success(visible ? 'Доступ к проекту открыт' : 'Проект скрыт от участника');
    } catch (failure) { setData(previous); toast.error(failure instanceof Error ? failure.message : 'Не удалось изменить доступ'); }
    finally { busy.current = false; setSaving(null); }
  };
  const updateMember = async (member: WorkspaceMember, role?: WorkspaceRole): Promise<void> => {
    if (busy.current) return;
    if (!role && !window.confirm(`Удалить участника «${member.displayName ?? member.email}» из пространства?`)) return;
    busy.current = true;
    setSaving(member.userId);
    try {
      if (role) await workspaceRepository.changeMemberRole(workspace.id, member.userId, role);
      else await workspaceRepository.removeMember(workspace.id, member.userId);
      await reload();
      refresh();
      window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT));
      toast.success(role ? 'Роль изменена' : 'Участник удалён');
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : 'Не удалось изменить участника'); }
    finally { busy.current = false; setSaving(null); }
  };

  if (!data) return error ? (
    <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => void reload()}>Повторить</Button></div>
  ) : <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Загружаем участников…</div>;

  const hiddenFor = (memberId: string): string[] => data.access.members.find((member) => member.userId === memberId)?.hiddenProjectIds ?? [];
  const visibleCount = data.members.filter((member) => !projectId || !hiddenFor(member.userId).includes(projectId)).length;
  return (
    <div className="space-y-4">
      <WorkspaceInviteForm key={workspace.id} workspace={workspace} projects={data.access.projects} onCreated={() => window.dispatchEvent(new Event('pf:workspace-invites-changed'))} />
      <div className="border-t pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
          <span>{projectId ? `Доступ к проекту: ${visibleCount} из ${data.members.length}` : `Участники пространства: ${data.members.length}`}</span>
          {saving && <span role="status">Сохраняем…</span>}
        </div>
        {error && <div role="alert" className="mb-2 text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => void reload()}>Повторить</button></div>}
        <ul className="divide-y">
          {data.members.map((member) => {
            const hidden = hiddenFor(member.userId);
            const protectedRole = member.role === 'owner' || member.role === 'lead';
            const visible = !projectId || !hidden.includes(projectId);
            return <li key={member.userId} className="space-y-2 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-8 shrink-0">
                  {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
                  <AvatarFallback className={avatarColor(member.displayName ?? member.email)}>{getInitials(member.displayName ?? member.email)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.displayName ?? member.email ?? 'Участник'}{member.userId === user?.id && <span className="font-normal text-muted-foreground"> (Вы)</span>}</p>
                  {member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
                  {!visible && <p className="text-xs text-muted-foreground">Проект скрыт</p>}
                </div>
              {manageRoles && workspace.role === 'owner' && workspace.kind !== 'default' ? <div className="flex shrink-0 items-center gap-1">
                <select aria-label={`Роль участника ${member.displayName ?? member.email}`} value={member.role} disabled={saving !== null} className="h-9 rounded-md border bg-background px-2 text-xs" onChange={(event) => void updateMember(member, event.target.value as WorkspaceRole)}>
                  {Object.entries(WORKSPACE_ROLE_LABEL).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                </select>
                <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-destructive" disabled={saving !== null} aria-label={`Удалить участника ${member.displayName ?? member.email}`} onClick={() => void updateMember(member)}><Trash2 className="size-4" /></Button>
              </div> : <span className="shrink-0 text-xs text-muted-foreground">{WORKSPACE_ROLE_LABEL[member.role]}</span>}
              {projectId && <label className="grid size-11 shrink-0 place-items-center sm:size-6"><Checkbox className="size-4" checked={visible} disabled={!canManage || protectedRole || saving !== null} aria-label={`Доступ к проекту: ${member.displayName ?? member.email}`} title={protectedRole ? 'Владелец и руководитель видят все проекты' : visible ? 'Скрыть проект от участника' : 'Открыть доступ к проекту'} onCheckedChange={(checked) => void updateAccess(member.userId, projectId, checked === true)} /></label>}
              </div>
              {!projectId && (protectedRole ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3" />Доступ ко всем проектам</p>
              ) : (
                <ProjectAccessChecklist projects={data.access.projects} hiddenIds={hidden} disabled={!canManage || saving !== null} onChange={(id, checked) => void updateAccess(member.userId, id, checked)} />
              ))}
            </li>;
          })}
        </ul>
        {data.members.length === 0 && <p className="py-3 text-sm text-muted-foreground">Участников пока нет.</p>}
        {canManage ? <p className="mt-2 text-xs text-muted-foreground">Снимите флажок, чтобы скрыть проект и его задачи. Доступ владельца и руководителя сохраняется.</p> : <p className="mt-2 text-xs text-muted-foreground">Доступ к проектам меняет владелец или руководитель пространства.</p>}
      </div>
    </div>
  );
}
