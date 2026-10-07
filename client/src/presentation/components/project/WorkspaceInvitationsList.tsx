import { useEffect, useState } from 'react';
import { Clock3, Copy, Mail, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { WORKSPACE_ROLE_LABEL, type Workspace } from '@/domain/workspace/Workspace';
import type { InviteDeliveryStatus, WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';
import type { WorkspaceAccessProject } from '@/domain/workspace/WorkspaceProjectAccess';
import { ProjectAccessChecklist } from './ProjectAccessChecklist';

const DELIVERY_LABELS: Record<InviteDeliveryStatus, string> = {
  queued: 'в очереди', sent: 'отправлено', failed: 'не отправлено',
  not_registered: 'нет аккаунта', not_connected: 'не подключён', unavailable: 'недоступна отправка',
};
const date = (value: Date): string => value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

export function WorkspaceInvitationsList({ workspace, invites, projects, onChanged }: {
  workspace: Workspace; invites: readonly WorkspaceInvite[]; projects: readonly WorkspaceAccessProject[]; onChanged: () => void;
}): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const { user } = useCurrentUser();
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const act = async (invite: WorkspaceInvite, action: 'copy' | 'resend' | 'revoke'): Promise<void> => {
    if (busy) return;
    if (action === 'revoke' && !window.confirm(`Отозвать приглашение для ${invite.email ?? 'этой ссылки'}?`)) return;
    setBusy(invite.id);
    try {
      if (action === 'copy') {
        const url = await workspaceRepository.getInviteLink(workspace.id, invite.id);
        await navigator.clipboard.writeText(url);
        toast.success('Ссылка на приглашение скопирована');
      } else if (action === 'resend') {
        await workspaceRepository.resendInvite(workspace.id, invite.id);
        toast.success(invite.email ? 'Повторная отправка запланирована' : 'Срок ссылки продлён на 7 дней');
      } else {
        await workspaceRepository.deleteInvite(workspace.id, invite.id);
        toast.success('Приглашение отозвано');
      }
      if (action !== 'copy') onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось выполнить действие'); }
    finally { setBusy(null); }
  };
  return <section aria-label="Ожидают принятия" className="space-y-3">
    <div className="flex items-center gap-2"><Clock3 className="size-4 text-amber-600 dark:text-amber-400" /><h3 className="text-sm font-semibold">Ожидают принятия</h3><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs tabular-nums text-amber-800 dark:bg-amber-950 dark:text-amber-200">{invites.length}</span></div>
    {invites.length === 0 ? <p className="rounded-lg bg-muted/40 px-3 py-3 text-xs leading-relaxed text-muted-foreground">Нет ожидающих приглашений. Отправленные появятся здесь и останутся до принятия или отзыва.</p> : <ul className="divide-y rounded-lg border border-amber-200/60 dark:border-amber-900/50">
      {invites.map(invite => {
        const expired = invite.expiresAt.getTime() <= now;
        const canManage = workspace.role === 'owner' || workspace.role === 'lead' || invite.createdByUserId === user?.id;
        const cooling = Boolean(invite.lastSentAt && now - invite.lastSentAt.getTime() < 60_000);
        const failed = Object.values(invite.delivery ?? {}).some(status => status === 'failed' || status === 'unavailable');
        return <li key={invite.id} className="space-y-2.5 p-3">
          <div className="flex min-w-0 items-start gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><Mail className="size-4" /></span><div className="min-w-0 flex-1">
            <p className="break-all text-sm font-medium">{invite.email ?? 'Приглашение по ссылке'}</p>
            <p className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">{expired ? 'Приглашение не принято · срок истёк' : 'Приглашение ещё не принято'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{WORKSPACE_ROLE_LABEL[invite.role]} · {expired ? 'Отправьте повторно, чтобы продлить срок' : `Действует до ${date(invite.expiresAt)}`}</p>
          </div></div>
          {invite.email && <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            {invite.delivery ? <div className="flex flex-wrap gap-x-3 gap-y-1">{(['email', 'site', 'telegram'] as const).map(channel => <span key={channel} className={invite.delivery?.[channel] === 'failed' || invite.delivery?.[channel] === 'unavailable' ? 'text-destructive' : ''}>{({ email: 'Почта', site: 'Сайт', telegram: 'Telegram' })[channel]}: {DELIVERY_LABELS[invite.delivery?.[channel] ?? 'queued']}</span>)}</div> : <p>Для этого приглашения нет данных об отправке. Можно отправить повторно.</p>}
            {failed && <p>{invite.deliveryNextAttemptAt ? 'Повторим неудавшуюся отправку автоматически.' : 'Отправьте повторно или передайте ссылку лично.'}</p>}
          </div>}
          <ProjectAccessChecklist projects={projects} hiddenIds={invite.excludedProjectIds ?? []} disabled onChange={() => undefined} label={`После принятия: ${invite.email ?? 'приглашённый'}`} />
          {canManage && <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" disabled={busy !== null || cooling} onClick={() => void act(invite, 'resend')} title={cooling ? 'Повторить можно через минуту' : undefined}><RotateCw className="size-3.5" />{cooling ? `Повтор через ${Math.max(1, Math.ceil((60_000 - (now - invite.lastSentAt!.getTime())) / 1000))} с` : invite.email ? 'Отправить повторно' : 'Продлить ссылку'}</Button>
            <Button variant="ghost" size="sm" disabled={busy !== null || expired} onClick={() => void act(invite, 'copy')} aria-label={`Скопировать приглашение для ${invite.email ?? 'участника'}`}><Copy className="size-3.5" />Ссылка</Button>
            <Button variant="ghost" size="icon" className="ml-auto size-9 text-muted-foreground hover:text-destructive" disabled={busy !== null} onClick={() => void act(invite, 'revoke')} aria-label={`Отозвать приглашение для ${invite.email ?? 'участника'}`}><Trash2 className="size-4" /></Button>
          </div>}
        </li>;
      })}
    </ul>}
  </section>;
}
