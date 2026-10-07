import { useRef, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { WORKSPACE_ROLE_LABEL, type Workspace } from '@/domain/workspace/Workspace';
import type { WorkspaceInvite, WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import type { WorkspaceAccessProject } from '@/domain/workspace/WorkspaceProjectAccess';
import { useContainer } from '@/infrastructure/di/container';
import { ProjectAccessChecklist } from './ProjectAccessChecklist';

export function WorkspaceInviteForm({ workspace, projects, onCreated }: {
  workspace: Workspace;
  projects: readonly WorkspaceAccessProject[];
  onCreated?: (invites: WorkspaceInvite[]) => void;
}): React.ReactElement | null {
  const { workspaceRepository } = useContainer();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceInviteRole>('editor');
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = workspace.role === 'owner' || workspace.role === 'lead';
  if (workspace.role === 'viewer' || workspace.kind === 'default') return null;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (lock.current) return;
    const emails = [...new Set(email.split(/[\s,;]+/).filter(Boolean).map((value) => value.toLowerCase()))];
    if (!emails.length || emails.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      setError('Проверьте email. Несколько адресов можно указать через запятую.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    const created: WorkspaceInvite[] = [];
    try {
      const results = await Promise.allSettled(emails.map((address) => workspaceRepository.createInvite(workspace.id, {
        email: address, role, ...(canManage ? { excludedProjectIds: hiddenIds } : {}),
      })));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failed.push(emails[index]);
          setError(result.reason instanceof Error ? result.reason.message : 'Не удалось создать приглашение. Попробуйте ещё раз.');
        } else created.push(result.value);
      });
      setEmail(failed.join(', '));
      if (results.length > failed.length) {
        const fresh = created.filter(invite => !invite.reused).length;
        toast.success(fresh ? `Приглашения в очереди отправки: ${fresh}` : 'Приглашение уже есть в списке ожидающих');
        onCreated?.(created);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <form onSubmit={event => void submit(event)} className="space-y-3 rounded-xl border border-primary/15 bg-primary/[0.035] p-3 sm:p-4">
    <div className="flex items-start gap-2.5">
      <UserPlus className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0"><p className="text-sm font-semibold">Новое приглашение</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">В пространство <span className="font-medium text-foreground">«{workspace.name}»</span></p></div>
    </div>
    <div className="flex flex-wrap gap-2">
      <label className="min-w-0 flex-[3_1_12rem] space-y-1.5"><span className="text-xs font-medium">Кого пригласить</span><Input value={email} onChange={event => setEmail(event.target.value)} disabled={busy} aria-label="Email для приглашения" aria-invalid={!!error} placeholder="Email, через запятую" autoComplete="email" /></label>
      <label className="min-w-0 flex-[1_1_9rem] space-y-1.5"><span className="text-xs font-medium">Роль в пространстве</span><select className="h-10 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Роль нового участника" value={role} disabled={busy} onChange={event => setRole(event.target.value as WorkspaceInviteRole)}>
        <option value="editor">{WORKSPACE_ROLE_LABEL.editor}</option><option value="viewer">{WORKSPACE_ROLE_LABEL.viewer}</option>
      </select></label>
    </div>
    {canManage ? <ProjectAccessChecklist projects={projects} hiddenIds={hiddenIds} label="Проекты для приглашённого" disabled={busy} onChange={(id, visible) => setHiddenIds(previous => visible ? previous.filter(item => item !== id) : [...previous, id])} /> : <p className="text-xs leading-relaxed text-muted-foreground">Приглашённому будут доступны те же проекты, что и вам. Изменить доступ может владелец или руководитель.</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-xs flex-1 text-xs leading-relaxed text-muted-foreground">Отправим письмо и уведомление на сайте. Если Telegram подключён — напишем и туда.</p>
      <Button type="submit" className="shrink-0" disabled={busy || !email.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}{busy ? 'Приглашаем…' : 'Пригласить'}</Button>
    </div>
  </form>;
}
