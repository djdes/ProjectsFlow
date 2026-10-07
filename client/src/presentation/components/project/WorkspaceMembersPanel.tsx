import { MemberListSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, Trash2, Users, FolderOpen } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { WORKSPACE_ROLE_LABEL, type Workspace, type WorkspaceMember, type WorkspaceRole } from '@/domain/workspace/Workspace';
import type { WorkspaceProjectAccess } from '@/domain/workspace/WorkspaceProjectAccess';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useWorkspacesContext } from '@/presentation/hooks/WorkspacesProvider';
import { PROJECT_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { ProjectAccessChecklist } from './ProjectAccessChecklist';
import type { WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';
import { WorkspaceInvitationsList } from './WorkspaceInvitationsList';
import { WorkspaceInviteForm } from './WorkspaceInviteForm';

export function WorkspaceMembersPanel({ workspace, projectId, manageRoles = true }: {
  workspace: Workspace;
  projectId?: string;
  manageRoles?: boolean;
}): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const { user } = useCurrentUser();
  const { refresh } = useWorkspacesContext();
  const [data, setData] = useState<{ members: WorkspaceMember[]; access: WorkspaceProjectAccess; invites: WorkspaceInvite[]; loadedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const mounted = useRef(true);
  const canInvite = workspace.kind !== 'default' && workspace.role !== 'viewer';
  const canManage = workspace.kind !== 'default' && (workspace.role === 'owner' || workspace.role === 'lead');
  const reload = useCallback(async () => {
    const current = ++seq.current;
    try {
      const [members, access, invites] = await Promise.all([
        workspaceRepository.listMembers(workspace.id), workspaceRepository.getProjectAccess(workspace.id),
        canInvite ? workspaceRepository.listInvites(workspace.id) : Promise.resolve([]),
      ]);
      if (mounted.current && current === seq.current) { setData({ members, access, invites, loadedAt: Date.now() }); setError(null); }
    } catch (failure) {
      if (mounted.current && current === seq.current) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить участников');
    }
  }, [workspace.id, workspaceRepository, canInvite]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const changed = (): void => { void reload(); };
    const storage = (event: StorageEvent): void => { if (event.key === 'pf:workspace-invites-changed') changed(); };
    window.addEventListener(PROJECT_CHANGED_EVENT, changed);
    window.addEventListener('pf:workspace-invites-changed', changed);
    window.addEventListener('focus', changed);
    window.addEventListener('storage', storage);
    return () => {
      mounted.current = false;
      window.removeEventListener(PROJECT_CHANGED_EVENT, changed);
      window.removeEventListener('pf:workspace-invites-changed', changed);
      window.removeEventListener('focus', changed);
      window.removeEventListener('storage', storage);
    };
  }, [reload]);
  const waitingDelivery = data?.invites.some(invite => invite.deliveryNextAttemptAt && invite.expiresAt.getTime() > data.loadedAt);
  const waitingAcceptance = Boolean(data?.invites.length);
  useEffect(() => {
    if (!waitingAcceptance) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, waitingDelivery ? 5000 : 30_000);
    return () => window.clearInterval(timer);
  }, [waitingDelivery, waitingAcceptance, reload]);
  const invitesChanged = (): void => {
    window.dispatchEvent(new Event('pf:workspace-invites-changed'));
    try { localStorage.setItem('pf:workspace-invites-changed', String(Date.now())); } catch { /* Storage is optional. */ }
  };

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
  ) : <MemberListSkeleton />;

  const hiddenFor = (memberId: string): string[] => data.access.members.find((member) => member.userId === memberId)?.hiddenProjectIds ?? [];
  const visibleCount = data.members.filter((member) => !projectId || !hiddenFor(member.userId).includes(projectId)).length;
  const currentProject = data.access.projects.find(project => project.id === projectId);
  return <div className="space-y-5" data-workspace-members={workspace.id}>
    {currentProject && <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><FolderOpen className="mt-0.5 size-4 shrink-0" /><p>Участники пространства <span className="font-medium text-foreground">«{workspace.name}»</span>. Проект <span className="font-medium text-foreground">«{currentProject.name}»</span> доступен {visibleCount} из {data.members.length}.</p></div>}
    <WorkspaceInviteForm key={workspace.id} workspace={workspace} projects={data.access.projects} onCreated={invitesChanged} />
    {canInvite && <WorkspaceInvitationsList workspace={workspace} invites={data.invites} projects={data.access.projects} onChanged={invitesChanged} />}
    <section aria-label="Участники пространства" className="space-y-3">
      <div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Участники пространства</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{data.members.length}</span>{saving && <span role="status" className="ml-auto text-xs text-muted-foreground">Сохраняем…</span>}</div>
      {error && <div role="alert" className="text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => void reload()}>Повторить</button></div>}
      <ul className="divide-y">
        {data.members.map(member => {
          const hidden = hiddenFor(member.userId);
          const protectedRole = member.role === 'owner' || member.role === 'lead';
          const name = member.displayName ?? member.email ?? 'Участник';
          const selfOwner = member.userId === user?.id && member.role === 'owner';
          return <li key={member.userId} className="space-y-2.5 py-3 first:pt-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Avatar className="size-9 shrink-0">{member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}<AvatarFallback className={avatarColor(name)}>{getInitials(name)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-[1_1_8rem]"><p className="truncate text-sm font-medium">{name}{member.userId === user?.id && <span className="font-normal text-muted-foreground"> (Вы)</span>}</p>{member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}</div>
              {manageRoles && workspace.role === 'owner' && workspace.kind !== 'default' && !selfOwner ? <div className="flex shrink-0 items-center gap-1">
                <select aria-label={`Роль участника ${name}`} value={member.role} disabled={saving !== null} className="h-9 max-w-full rounded-md border bg-background px-2 text-xs" onChange={event => void updateMember(member, event.target.value as WorkspaceRole)}>{Object.entries(WORKSPACE_ROLE_LABEL).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>
                <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-destructive" disabled={saving !== null} aria-label={`Удалить участника ${name}`} onClick={() => void updateMember(member)}><Trash2 className="size-4" /></Button>
              </div> : <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{WORKSPACE_ROLE_LABEL[member.role]}</span>}
            </div>
            {protectedRole ? <p className="flex items-center gap-1.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><LockKeyhole className="size-3.5" />Все проекты доступны по роли</p> : <ProjectAccessChecklist projects={data.access.projects} hiddenIds={hidden} label={`Проекты: ${name}`} highlightProjectId={projectId} disabled={!canManage || saving !== null} onChange={(id, checked) => void updateAccess(member.userId, id, checked)} />}
          </li>;
        })}
      </ul>
      {data.members.length === 0 && <p className="text-sm text-muted-foreground">Участников пока нет.</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">{canManage ? 'Снимите отметку у проекта, чтобы скрыть его и задачи от выбранного участника. Владелец и руководитель всегда видят все проекты.' : 'Доступ к проектам меняет владелец или руководитель пространства.'}</p>
    </section>
  </div>;
}
