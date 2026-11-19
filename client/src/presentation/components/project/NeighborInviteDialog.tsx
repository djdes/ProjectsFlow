import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send, UsersRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { WORKSPACE_ROLE_LABEL, type Workspace } from '@/domain/workspace/Workspace';
import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import type { InviteCandidate } from '@/domain/workspace/InviteCandidate';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import { filterCandidates, neighborInviteSummary } from './neighborCandidates';

const initials = (candidate: InviteCandidate): string =>
  (candidate.displayName ?? candidate.email).trim().slice(0, 1).toUpperCase() || '?';

/**
 * «Из соседних пространств»: люди из других пространств приглашающего одним списком — отметить
 * галочками и пригласить разом. Доставка как у приглашения по почте: письмо, уведомление на
 * сайте с «Принять» и Telegram, если он привязан.
 */
export function NeighborInviteDialog({
  open,
  onOpenChange,
  workspace,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  onInvited: () => void;
}): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const [candidates, setCandidates] = useState<InviteCandidate[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState<WorkspaceInviteRole>('editor');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCandidates(null);
    setSelected([]);
    setQuery('');
    workspaceRepository
      .listInviteCandidates(workspace.id)
      .then((list) => {
        if (!cancelled) setCandidates(list);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCandidates([]);
        toast.error((error as Error).message || 'Не удалось загрузить список');
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspace.id, workspaceRepository]);

  const visible = useMemo(() => filterCandidates(candidates ?? [], query), [candidates, query]);

  const toggle = (userId: string): void =>
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );

  const send = async (): Promise<void> => {
    if (selected.length === 0 || sending) return;
    setSending(true);
    try {
      const results = await workspaceRepository.inviteNeighbors(workspace.id, selected, role);
      const summary = neighborInviteSummary(results.map((result) => result.status));
      if (summary.kind === 'success') toast.success(summary.text);
      else if (summary.kind === 'warning') toast.warning(summary.text);
      else toast.error(summary.text);
      if (summary.kind !== 'error') {
        onInvited();
        onOpenChange(false);
      }
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось отправить приглашения');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(40rem,90dvh)] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Из соседних пространств</DialogTitle>
          <DialogDescription>
            Люди из других ваших пространств, которых ещё нет в «{workspace.name}».
          </DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя, почта или пространство"
          aria-label="Поиск по людям"
          autoFocus
        />
        <div className="-mx-1 min-h-24 flex-1 overflow-y-auto px-1">
          {candidates === null ? (
            <div className="space-y-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {candidates.length === 0
                ? 'В других ваших пространствах нет людей, которых можно позвать сюда.'
                : 'Никого не нашли.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {visible.map((candidate) => {
                const checked = selected.includes(candidate.userId);
                return (
                  <li key={candidate.userId}>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-1.5',
                        candidate.invited ? 'opacity-60' : 'cursor-pointer hover:bg-muted/60',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={candidate.invited || sending}
                        onCheckedChange={() => toggle(candidate.userId)}
                        aria-label={`Пригласить ${candidate.displayName ?? candidate.email}`}
                      />
                      <Avatar className="size-8">
                        {candidate.avatarUrl ? <AvatarImage src={candidate.avatarUrl} alt="" /> : null}
                        <AvatarFallback>{initials(candidate)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{candidate.displayName ?? candidate.email}</span>
                          {candidate.hasTelegram && (
                            <Send className="size-3 shrink-0 text-muted-foreground" aria-label="Telegram подключён" />
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {candidate.email} · {candidate.workspaces.map((w) => w.name).join(', ')}
                        </span>
                      </span>
                      {candidate.invited && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                          приглашён
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-sm sm:me-auto">
            <span className="text-muted-foreground">Роль</span>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Роль приглашённых"
              value={role}
              disabled={sending}
              onChange={(event) => setRole(event.target.value as WorkspaceInviteRole)}
            >
              <option value="editor">{WORKSPACE_ROLE_LABEL.editor}</option>
              <option value="viewer">{WORKSPACE_ROLE_LABEL.viewer}</option>
            </select>
          </label>
          <Button type="button" disabled={selected.length === 0 || sending} onClick={() => void send()}>
            {sending ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <UsersRound className="size-4" />}
            {selected.length > 0 ? `Пригласить (${selected.length})` : 'Пригласить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
