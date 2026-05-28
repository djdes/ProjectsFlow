import { useEffect, useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';
import type { SharedMember } from '@/application/project/ProjectRepository';
import type { ProjectInviteRole } from '@/domain/project/ProjectInvite';
import { useContainer } from '@/infrastructure/di/container';
import { useProjects } from '@/presentation/hooks/useProjects';
import { defaultProjectIcon as ProjectIcon } from '@/presentation/layout/projectIcons';

// Простая email-валидация: достаточно для UX (хоть @, хоть .domain). Серверная zod-схема
// делает строгую проверку при createInvite — здесь не дублируем.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type BatchResult = {
  readonly projectId: string;
  readonly projectName: string;
  readonly email: string;
  readonly ok: boolean;
  readonly error?: string;
};

export function ProjectsShareCard(): React.ReactElement {
  const { projectRepository } = useContainer();
  const { data: projects } = useProjects();

  // Проекты, в которые caller может приглашать: invite_member требует editor-роль и выше
  // (см. permissions matrix). Viewer'ы — не могут. Inbox исключаем — invite в него запрещён.
  const ownProjects = useMemo(
    () =>
      (projects ?? []).filter(
        (p) => (p.role === 'owner' || p.role === 'editor') && !p.isInbox,
      ),
    [projects],
  );

  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [emailDraft, setEmailDraft] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<ProjectInviteRole>('editor');
  const [shared, setShared] = useState<SharedMember[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);

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

  const toggleProject = (id: string): void => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllProjects = (): void => {
    if (selectedProjectIds.size === ownProjects.length) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(ownProjects.map((p) => p.id)));
    }
  };

  const addEmail = (raw: string): void => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      toast.error(`Невалидный email: ${trimmed}`);
      return;
    }
    if (emails.includes(trimmed)) return;
    setEmails((prev) => [...prev, trimmed]);
  };

  const commitDraft = (): void => {
    // Разбираем введённое: запятая, точка с запятой, пробел, новая строка — разделители.
    const tokens = emailDraft.split(/[\s,;]+/).filter((s) => s.length > 0);
    tokens.forEach(addEmail);
    setEmailDraft('');
  };

  const removeEmail = (e: string): void => {
    setEmails((prev) => prev.filter((x) => x !== e));
  };

  const handleAddFromShared = (m: SharedMember): void => {
    addEmail(m.email);
  };

  const handleSubmit = async (): Promise<void> => {
    // На submit допиливаем то, что юзер не успел подтвердить Enter'ом.
    if (emailDraft.trim().length > 0) commitDraft();
    const finalEmails = (() => {
      const draftTokens = emailDraft.split(/[\s,;]+/).filter((s) => s.length > 0).map((s) => s.toLowerCase());
      const set = new Set<string>(emails);
      draftTokens.forEach((t) => {
        if (EMAIL_RE.test(t)) set.add(t);
      });
      return [...set];
    })();

    if (selectedProjectIds.size === 0 || finalEmails.length === 0) return;

    setSubmitting(true);
    setResults(null);

    // Параллельно через allSettled: один невалидный проект/email не должен ломать остальные.
    const pairs: { projectId: string; projectName: string; email: string }[] = [];
    for (const projectId of selectedProjectIds) {
      const project = ownProjects.find((p) => p.id === projectId);
      if (!project) continue;
      for (const email of finalEmails) {
        pairs.push({ projectId, projectName: project.name, email });
      }
    }

    const settled = await Promise.allSettled(
      pairs.map(({ projectId, email }) =>
        projectRepository.createInvite(projectId, { role, email }),
      ),
    );

    const batch: BatchResult[] = settled.map((s, i) => {
      const p = pairs[i]!;
      if (s.status === 'fulfilled') {
        return { projectId: p.projectId, projectName: p.projectName, email: p.email, ok: true };
      }
      const err = s.reason instanceof Error ? s.reason.message : String(s.reason);
      return {
        projectId: p.projectId,
        projectName: p.projectName,
        email: p.email,
        ok: false,
        error: err,
      };
    });
    setResults(batch);
    setSubmitting(false);

    const okCount = batch.filter((r) => r.ok).length;
    const failCount = batch.length - okCount;
    if (failCount === 0) {
      toast.success(`Отправлено приглашений: ${okCount}`);
      // На успехе чистим — карточка готова к следующему батчу.
      setSelectedProjectIds(new Set());
      setEmails([]);
    } else {
      toast.error(`Готово: ${okCount} ок, ${failCount} с ошибкой. Смотри подробности ниже.`);
    }
  };

  // Чтобы кнопка показывала корректное число — учитываем и то, что юзер ещё не подтвердил.
  const previewEmailsCount = (() => {
    const set = new Set(emails);
    emailDraft
      .split(/[\s,;]+/)
      .filter((s) => s.length > 0 && EMAIL_RE.test(s.trim().toLowerCase()))
      .forEach((t) => set.add(t.trim().toLowerCase()));
    return set.size;
  })();
  const inviteCount = selectedProjectIds.size * previewEmailsCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Общий доступ к проектам</CardTitle>
        <CardDescription>
          Пригласи людей сразу в несколько проектов (где у тебя роль редактора или
          владельца). Зарегистрированным юзерам придёт уведомление в системе, остальным —
          письмо со ссылкой.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {ownProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            У тебя пока нет проектов с правом приглашать (нужна роль редактора или
            владельца).
          </p>
        ) : (
          <>
            {/* Список проектов с чекбоксами */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Проекты</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={toggleAllProjects}
                  className="h-7 px-2 text-xs"
                >
                  {selectedProjectIds.size === ownProjects.length
                    ? 'Снять все'
                    : 'Выбрать все'}
                </Button>
              </div>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border bg-card/40 p-1">
                {ownProjects.map((p) => {
                  const checked = selectedProjectIds.has(p.id);
                  return (
                    <li key={p.id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          'hover:bg-muted',
                          checked && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProject(p.id)}
                          className="size-4 shrink-0 cursor-pointer accent-primary"
                        />
                        <ProjectIcon
                          className={cn(
                            'size-4 shrink-0',
                            p.gitRepoUrl ? 'text-emerald-500' : 'text-muted-foreground',
                          )}
                        />
                        <span className="flex-1 truncate">{p.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Email-чипсы + ввод */}
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
                        <DropdownMenuItem key={m.id} onSelect={() => handleAddFromShared(m)}>
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
                Разделители — запятая, точка с запятой, пробел или Enter. Можно добавить
                несколько email сразу.
              </p>
            </div>

            {/* Роль */}
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

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Будет создано{' '}
                <span className="font-medium text-foreground tabular-nums">{inviteCount}</span>{' '}
                приглашений{inviteCount > 0 && ` (${selectedProjectIds.size} × ${previewEmailsCount})`}.
              </p>
              <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting || inviteCount === 0}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                Пригласить
              </Button>
            </div>

            {/* Результаты последнего batch'а — показываем только если есть ошибки или явно
                хочется sanity-check. Прячем после успешного полного батча (см. handleSubmit). */}
            {results && results.length > 0 && (
              <div className="space-y-1 rounded-md border bg-muted/30 p-2">
                <p className="text-xs font-medium text-muted-foreground">Результаты</p>
                <ul className="space-y-0.5 text-xs">
                  {results.map((r) => (
                    <li key={`${r.projectId}-${r.email}`} className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'inline-block min-w-12 shrink-0 font-medium',
                          r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                        )}
                      >
                        {r.ok ? 'OK' : 'ОШИБКА'}
                      </span>
                      <span className="truncate">
                        {r.projectName} · {r.email}
                        {r.error && <span className="ml-1 text-muted-foreground">— {r.error}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
