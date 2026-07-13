import { useEffect, useState } from 'react';
import { Loader2, UserPlus, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import type { SharedMember } from '@/application/project/ProjectRepository';
import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';

// Простая email-валидация: UX-уровень, строгую делает сервер.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Карточка «Пригласить в пространство» в профиле. Раньше приглашала в выбранные проекты
// по отдельности; теперь доступ единый — приглашаем в активное пространство (все проекты,
// включая будущие).
export function ProjectsShareCard(): React.ReactElement {
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

  // Учитываем и неподтверждённый драфт — счётчик/кнопка честные.
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Пригласить в пространство</CardTitle>
        <CardDescription>
          Участники получат доступ ко всем проектам пространства
          {workspace ? ` «${workspace.name}»` : ''}, включая будущие. Зарегистрированным
          придёт уведомление в системе, остальным — письмо со ссылкой.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="share-emails">Кого пригласить</Label>
            {shared && shared.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                    <Users className="size-3.5" />
                    Из знакомых
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                  {shared.map((m) => (
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
            <ul className="flex flex-wrap gap-1.5">
              {emails.map((e) => (
                <li
                  key={e}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs"
                >
                  <span>{e}</span>
                  <button
                    type="button"
                    onClick={() => removeEmail(e)}
                    aria-label={`Убрать ${e}`}
                    className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Input
            id="share-emails"
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
            placeholder="kolya@example.com, lena@example.com"
          />
          <p className="text-xs text-muted-foreground">
            Разделители — запятая, точка с запятой, пробел или Enter.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Роль</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={role === 'editor' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRole('editor')}
              className="flex-1"
            >
              Редактор
            </Button>
            <Button
              type="button"
              variant={role === 'viewer' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRole('viewer')}
              className="flex-1"
            >
              Наблюдатель
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || previewEmails.length === 0 || !workspace}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Пригласить{previewEmails.length > 0 ? ` (${previewEmails.length})` : ''}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
