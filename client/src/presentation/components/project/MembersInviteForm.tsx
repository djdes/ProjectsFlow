import { useEffect, useState } from 'react';
import { Loader2, UserPlus, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { SharedMember } from '@/application/project/ProjectRepository';
import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';

// Простая email-валидация для UX (строгую делает сервер). Та же, что в ProjectsShareCard.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Компактная форма приглашения в ПРОСТРАНСТВО — живёт в подвале панели участников
// (см. MembersHoverPanel). Несколько email сразу (чипсы), «Из знакомых», роль, отправка
// батчем через workspaceRepository.createInvite. Приглашённый получает доступ ко всем
// проектам пространства.
export function MembersInviteForm(): React.ReactElement {
  const { workspaceRepository, projectRepository } = useContainer();
  const { workspace } = useCurrentWorkspace();
  const [emailDraft, setEmailDraft] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<WorkspaceInviteRole>('editor');
  const [shared, setShared] = useState<SharedMember[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .listSharedMembers()
      .then((list) => {
        if (!cancelled) setShared(list);
      })
      .catch(() => {
        if (!cancelled) setShared([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository]);

  const addEmail = (raw: string): void => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      toast.error(`Невалидный email: ${trimmed}`);
      return;
    }
    setEmails((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const commitDraft = (): void => {
    emailDraft
      .split(/[\s,;]+/)
      .filter((s) => s.length > 0)
      .forEach(addEmail);
    setEmailDraft('');
  };

  const removeEmail = (e: string): void => {
    setEmails((prev) => prev.filter((x) => x !== e));
  };

  // Учитываем и неподтверждённый драфт — чтобы счётчик/кнопка были честными.
  const previewEmails = (() => {
    const set = new Set(emails);
    emailDraft
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && EMAIL_RE.test(s))
      .forEach((t) => set.add(t));
    return [...set];
  })();

  const handleSubmit = async (): Promise<void> => {
    const finalEmails = previewEmails;
    if (finalEmails.length === 0 || !workspace) return;
    setSubmitting(true);
    const settled = await Promise.allSettled(
      finalEmails.map((email) => workspaceRepository.createInvite(workspace.id, { role, email })),
    );
    setSubmitting(false);
    const ok = settled.filter((s) => s.status === 'fulfilled').length;
    const fail = settled.length - ok;
    if (fail === 0) {
      toast.success(ok === 1 ? 'Приглашение отправлено' : `Отправлено приглашений: ${ok}`);
      setEmails([]);
      setEmailDraft('');
    } else {
      const firstErr = settled.find((s) => s.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      const msg = firstErr ? (firstErr.reason as Error).message : '';
      toast.error(`${ok} ок, ${fail} с ошибкой${msg ? ` — ${msg}` : ''}`);
    }
  };

  const hasShared = shared !== null && shared.length > 0;

  return (
    <div className="space-y-2 border-t p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Пригласить в пространство</span>
        {hasShared && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs">
                <Users className="size-3.5" />
                Из знакомых
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-60 w-60 overflow-y-auto">
              {shared!.map((m) => (
                <DropdownMenuItem key={m.id} onSelect={() => addEmail(m.email)}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{m.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {emails.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {emails.map((e) => (
            <li
              key={e}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
            >
              <span className="max-w-[140px] truncate">{e}</span>
              <button
                type="button"
                onClick={() => removeEmail(e)}
                aria-label={`Убрать ${e}`}
                className="grid size-3.5 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Input
        type="email"
        value={emailDraft}
        onChange={(e) => setEmailDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            e.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        placeholder="kolya@example.com"
        className="h-8"
      />

      <div className="flex gap-1.5">
        <Button
          type="button"
          variant={role === 'editor' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setRole('editor')}
          className="h-7 flex-1 text-xs"
        >
          Редактор
        </Button>
        <Button
          type="button"
          variant={role === 'viewer' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setRole('viewer')}
          className="h-7 flex-1 text-xs"
        >
          Наблюдатель
        </Button>
      </div>

      <Button
        type="button"
        size="sm"
        className={cn('h-8 w-full gap-1.5')}
        disabled={submitting || previewEmails.length === 0 || !workspace}
        onClick={() => void handleSubmit()}
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        Пригласить{previewEmails.length > 0 ? ` (${previewEmails.length})` : ''}
      </Button>
    </div>
  );
}
