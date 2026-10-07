import { useRef, useState } from 'react';
import { Copy, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { WORKSPACE_ROLE_LABEL, type Workspace } from '@/domain/workspace/Workspace';
import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import type { WorkspaceAccessProject } from '@/domain/workspace/WorkspaceProjectAccess';
import { useContainer } from '@/infrastructure/di/container';
import { ProjectAccessChecklist } from './ProjectAccessChecklist';

export function WorkspaceInviteForm({ workspace, projects, onCreated }: {
  workspace: Workspace;
  projects: readonly WorkspaceAccessProject[];
  onCreated?: () => void;
}): React.ReactElement | null {
  const { workspaceRepository } = useContainer();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceInviteRole>('editor');
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<Array<{ email: string; url: string }>>([]);
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
    const created: Array<{ email: string; url: string }> = [];
    try {
      const results = await Promise.allSettled(emails.map((address) => workspaceRepository.createInvite(workspace.id, {
        email: address, role, ...(canManage ? { excludedProjectIds: hiddenIds } : {}),
      })));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failed.push(emails[index]);
          setError(result.reason instanceof Error ? result.reason.message : 'Не удалось создать приглашение. Попробуйте ещё раз.');
        } else if (result.value.url) created.push({ email: emails[index], url: result.value.url });
      });
      setEmail(failed.join(', '));
      setLinks((previous) => [...previous, ...created]);
      if (results.length > failed.length) {
        toast.success(`Приглашения созданы: ${results.length - failed.length}`);
        onCreated?.();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <div>
        <p className="text-sm font-medium">Пригласить в пространство</p>
        <p className="mt-1 text-xs text-muted-foreground">«{workspace.name}» · Приглашение действует 7 дней.</p>
      </div>
      <Input value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} aria-label="Email для приглашения" aria-invalid={!!error} placeholder="Email, через запятую" autoComplete="email" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select className="h-10 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Роль нового участника" value={role} disabled={busy} onChange={(event) => setRole(event.target.value as WorkspaceInviteRole)}>
          <option value="editor">{WORKSPACE_ROLE_LABEL.editor}</option>
          <option value="viewer">{WORKSPACE_ROLE_LABEL.viewer}</option>
        </select>
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {busy ? 'Приглашаем…' : 'Пригласить'}
        </Button>
      </div>
      {canManage ? (
        <ProjectAccessChecklist projects={projects} hiddenIds={hiddenIds} disabled={busy} onChange={(id, visible) => setHiddenIds((previous) => visible ? previous.filter((item) => item !== id) : [...previous, id])} />
      ) : <p className="text-xs text-muted-foreground">Участнику будут доступны те же проекты, что и вам. Изменить доступ может владелец или руководитель.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {links.length > 0 && <div className="space-y-1 rounded-md bg-muted/50 p-2" aria-live="polite">
        <p className="text-xs text-muted-foreground">Если письмо не пришло, передайте ссылку лично.</p>
        {links.map((link) => <div key={link.url} className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-xs">{link.email}</span>
          <Button type="button" variant="ghost" size="sm" aria-label={`Скопировать приглашение для ${link.email}`} onClick={() => void navigator.clipboard.writeText(link.url).then(() => toast.success('Ссылка скопирована')).catch(() => toast.error('Не удалось скопировать ссылку'))}><Copy className="size-3.5" />Ссылка</Button>
        </div>)}
      </div>}
    </form>
  );
}
