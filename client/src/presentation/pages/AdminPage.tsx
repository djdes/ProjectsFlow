import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, Check, ChevronRight, ExternalLink, Eye, Github, LifeBuoy, Loader2, Mail, Pencil, Send, Shield, Star, FolderGit2, GitCommitHorizontal, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { AdminProject, AdminSupportTicket, AdminUser, EmailTemplateMeta, EmailPreview } from '@/application/admin/AdminRepository';
import { relativeTime } from '@/lib/relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import { getInitials } from '@/presentation/layout/projectIcons';
import { AdminUserDispatchersDialog } from '@/presentation/components/admin/AdminUserDispatchersDialog';
import { AdminUserFavoritesDialog } from '@/presentation/components/admin/AdminUserFavoritesDialog';

type Tab = 'projects' | 'users' | 'support' | 'email';

const TABS: readonly Tab[] = ['projects', 'users', 'support', 'email'];

export function AdminPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  // Дип-линк из уведомления о новом обращении: /admin?tab=support.
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'projects',
  );

  return (
    <div className="flex h-full flex-col gap-5 p-4 pt-3.5 sm:p-6 sm:pt-4">
      <div className="flex items-center gap-2.5">
        <Shield className="size-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Администрирование</h1>
      </div>

      <div className="inline-flex w-fit items-center gap-0.5 rounded-md border bg-card p-0.5 text-sm">
        <TabButton active={tab === 'projects'} onClick={() => setTab('projects')}>
          <FolderGit2 className="size-4" /> Проекты
        </TabButton>
        <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
          <Users className="size-4" /> Пользователи
        </TabButton>
        <TabButton active={tab === 'support'} onClick={() => setTab('support')}>
          <LifeBuoy className="size-4" /> Поддержка
        </TabButton>
        <TabButton active={tab === 'email'} onClick={() => setTab('email')}>
          <Mail className="size-4" /> Email
        </TabButton>
      </div>

      {tab === 'projects' && <ProjectsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'support' && <SupportTab />}
      {tab === 'email' && <EmailTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function SupportTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [tickets, setTickets] = useState<AdminSupportTicket[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = (): void => {
    adminRepository
      .listSupportTickets()
      .then(setTickets)
      .catch((e: unknown) => toast.error(`Не удалось загрузить: ${(e as Error).message}`));
  };
  useEffect(reload, [adminRepository]);

  const toggleStatus = async (t: AdminSupportTicket): Promise<void> => {
    const next = t.status === 'open' ? 'closed' : 'open';
    setBusy(t.id);
    try {
      await adminRepository.setSupportTicketStatus(t.id, next);
      reload();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!tickets) return <ListSkeleton />;
  if (tickets.length === 0) {
    return (
      <p className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        Обращений пока нет.
      </p>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-lg border bg-card">
      {tickets.map((t) => (
        <li key={t.id} className={cn('space-y-1.5 px-4 py-3', t.status === 'closed' && 'opacity-60')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{t.submitterDisplayName ?? 'Аноним'}</span>
                {t.submitterEmail && (
                  <span className="truncate text-xs text-muted-foreground">{t.submitterEmail}</span>
                )}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t.source === 'landing' ? 'лендинг' : 'приложение'}
                </span>
                {t.status === 'closed' && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    закрыто
                  </span>
                )}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{t.message}</p>
              <p className="text-xs text-muted-foreground">{relativeTime(new Date(t.createdAt))}</p>
            </div>
            <Button
              size="sm"
              variant={t.status === 'open' ? 'outline' : 'ghost'}
              disabled={busy === t.id}
              onClick={() => void toggleStatus(t)}
            >
              {t.status === 'open' ? 'Закрыть' : 'Открыть'}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProjectsTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [projects, setProjects] = useState<AdminProject[] | null>(null);

  useEffect(() => {
    adminRepository
      .listProjects()
      .then(setProjects)
      .catch((e: unknown) => toast.error(`Не удалось загрузить: ${(e as Error).message}`));
  }, [adminRepository]);

  const replaceProject = (id: string, patch: Partial<AdminProject>): void => {
    setProjects((prev) => prev?.map((p) => (p.id === id ? { ...p, ...patch } : p)) ?? prev);
  };

  if (!projects) return <ListSkeleton />;
  if (projects.length === 0) {
    return <EmptyBox>Проектов нет.</EmptyBox>;
  }

  // Группировка по владельцу. Проект уникален (без дублей по members).
  const groups = new Map<string, { owner: string; email: string; items: AdminProject[] }>();
  for (const p of projects) {
    const g = groups.get(p.ownerId) ?? { owner: p.ownerDisplayName, email: p.ownerEmail, items: [] };
    g.items.push(p);
    groups.set(p.ownerId, g);
  }

  return (
    <div className="space-y-6 overflow-y-auto">
      {[...groups.values()].map((g) => (
        <section key={g.email} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Avatar className="size-6">
              <AvatarFallback className="text-[10px]">{getInitials(g.owner)}</AvatarFallback>
            </Avatar>
            {g.owner} <span className="text-xs">· {g.email}</span>
          </h2>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {g.items.map((p) => (
              <li key={p.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{p.status}</span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" /> {p.memberCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <GitCommitHorizontal className="size-3" /> {p.taskCount} задач
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/projects/${p.id}`}>Доска</Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/projects/${p.id}/overview`}>Обзор</Link>
                    </Button>
                  </div>
                </div>
                <EditableProjectRepo
                  projectId={p.id}
                  currentUrl={p.gitRepoUrl}
                  onSaved={(newUrl) => replaceProject(p.id, { gitRepoUrl: newUrl })}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Inline-редактирование gitRepoUrl проекта (admin-only — на странице админ-панели).
// View: иконка GH + URL (или «не подключён») + ✏ pencil. Edit: <Input> + ✓ / ✕.
// PATCH /api/projects/:id с admin-bypass (update_project = editor+, admin проходит).
//
// Сохранение: пустая строка → null (отвязать). Невалидный URL — пусть сервер
// валидирует и вернёт ошибку в toast.
function EditableProjectRepo({
  projectId,
  currentUrl,
  onSaved,
}: {
  projectId: string;
  currentUrl: string | null;
  onSaved: (newUrl: string | null) => void;
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentUrl ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = (): void => {
    setDraft(currentUrl ?? '');
    setEditing(true);
  };
  const cancelEdit = (): void => {
    setEditing(false);
    setDraft(currentUrl ?? '');
  };
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const trimmed = draft.trim();
      const newUrl = trimmed.length === 0 ? null : trimmed;
      // Patch уважает null = очистить (см. UpdateProjectInput).
      await projectRepository.update(projectId, { gitRepoUrl: newUrl });
      onSaved(newUrl);
      setEditing(false);
      toast.success(newUrl === null ? 'Git-репо отвязан' : 'Git-репо обновлён');
    } catch (e) {
      toast.error((e as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') cancelEdit();
          }}
          autoFocus
          disabled={saving}
          placeholder="https://github.com/owner/repo (или пусто чтобы отвязать)"
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={saving}
          onClick={() => void save()}
          aria-label="Сохранить"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={saving}
          onClick={cancelEdit}
          aria-label="Отмена"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
      {currentUrl ? (
        <a
          href={currentUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-foreground hover:underline"
          title={currentUrl}
        >
          <span className="truncate">{currentUrl}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <span className="italic text-muted-foreground">не подключён</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-6"
        onClick={startEdit}
        aria-label="Изменить git-репо"
        title="Изменить git-репо"
      >
        <Pencil className="size-3" />
      </Button>
    </div>
  );
}

function UsersTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [dispatchersUser, setDispatchersUser] = useState<AdminUser | null>(null);
  const [favoritesUser, setFavoritesUser] = useState<AdminUser | null>(null);

  const reload = (): void => {
    adminRepository
      .listUsers()
      .then(setUsers)
      .catch((e: unknown) => toast.error(`Не удалось загрузить: ${(e as Error).message}`));
  };

  useEffect(reload, [adminRepository]);

  const toggleAdmin = async (u: AdminUser): Promise<void> => {
    try {
      await adminRepository.updateUser(u.id, { isAdmin: !u.isAdmin });
      toast.success(u.isAdmin ? 'Права админа сняты' : 'Назначен админом');
      reload();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  if (!users) return <ListSkeleton />;

  return (
    <>
      <ul className="divide-y overflow-y-auto overflow-x-hidden rounded-lg border bg-card">
        {users.map((u) => (
          <li key={u.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="text-[11px]">{getInitials(u.displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {u.displayName}
                  {u.isAdmin && (
                    <span className="rounded bg-primary/15 px-1.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                      admin
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {u.email} · {u.projectCount} проектов
                </p>
                {u.ownedProjectCount > 0 && (
                  <p
                    className="mt-0.5 inline-flex items-center gap-1 truncate text-xs text-muted-foreground"
                    title={
                      u.githubConnected
                        ? `${u.delegationEnabledCount} из ${u.ownedProjectCount} owned-проектов имеют делегацию GitHub-токена`
                        : 'GitHub у юзера не подключён — делегацию включить нельзя'
                    }
                  >
                    <Github className="size-3" />
                    <span>
                      Делегация:{' '}
                      {u.githubConnected ? (
                        <span
                          className={
                            u.delegationEnabledCount > 0
                              ? 'font-medium text-emerald-700 dark:text-emerald-400'
                              : ''
                          }
                        >
                          {u.delegationEnabledCount}/{u.ownedProjectCount}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">
                          GitHub не подключён
                        </span>
                      )}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-11">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDispatchersUser(u)}
                title="Управление Ralph-диспетчерами в проектах этого юзера"
              >
                <Bot className="size-4" />
                Диспетчеры
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFavoritesUser(u)}
                title="Управление избранными проектами этого юзера"
              >
                <Star className="size-4" />
                Избранное
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                Изменить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void toggleAdmin(u)}>
                {u.isAdmin ? 'Снять админа' : 'Сделать админом'}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {dispatchersUser && (
        <AdminUserDispatchersDialog
          user={dispatchersUser}
          onClose={() => setDispatchersUser(null)}
        />
      )}

      {favoritesUser && (
        <AdminUserFavoritesDialog
          user={favoritesUser}
          onClose={() => setFavoritesUser(null)}
        />
      )}
    </>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { adminRepository } = useContainer();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await adminRepository.updateUser(user.id, { displayName, email });
      toast.success('Пользователь обновлён');
      onSaved();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактировать пользователя</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="admin-edit-name">Имя</Label>
            <Input
              id="admin-edit-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-edit-email">Email</Label>
            <Input
              id="admin-edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmailTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [templates, setTemplates] = useState<EmailTemplateMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [showText, setShowText] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    adminRepository
      .listEmailTemplates()
      .then((t) => {
        setTemplates(t);
        if (t.length > 0 && !selected) setSelected(t[0]!.key);
      })
      .catch((e: unknown) => toast.error(`Не удалось загрузить шаблоны: ${(e as Error).message}`));
  }, [adminRepository]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    setLoadingPreview(true);
    setPreview(null);
    adminRepository
      .previewEmail(selected)
      .then(setPreview)
      .catch((e: unknown) => toast.error(`Не удалось загрузить предпросмотр: ${(e as Error).message}`))
      .finally(() => setLoadingPreview(false));
  }, [selected, adminRepository]);

  useEffect(() => {
    if (!preview || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(preview.html);
      doc.close();
    }
  }, [preview]);

  const handleSend = async (): Promise<void> => {
    if (!selected || !recipientEmail.trim()) return;
    setSending(true);
    try {
      await adminRepository.sendTestEmail(selected, recipientEmail.trim());
      toast.success(`Тестовое письмо отправлено на ${recipientEmail.trim()}`);
    } catch (e) {
      toast.error(`Ошибка отправки: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  if (!templates) return <ListSkeleton />;

  const selectedMeta = templates.find((t) => t.key === selected);

  return (
    <div className="flex flex-col gap-4 overflow-hidden lg:flex-row">
      {/* Список шаблонов */}
      <div className="w-full shrink-0 lg:w-72">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Шаблоны ({templates.length})</h2>
        <ul className="divide-y overflow-y-auto rounded-lg border bg-card lg:max-h-[calc(100vh-220px)]">
          {templates.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => setSelected(t.key)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors',
                  selected === t.key
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-muted/50',
                )}
              >
                <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                {selected === t.key && <ChevronRight className="size-3.5 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Предпросмотр + отправка */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {selectedMeta && (
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{selectedMeta.label}</h2>
            <p className="text-sm text-muted-foreground">{selectedMeta.description}</p>
          </div>
        )}

        {/* Превью */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Eye className="size-3.5 text-muted-foreground" />
              <span className="font-medium">Предпросмотр</span>
              {preview && (
                <span className="text-xs text-muted-foreground">· {preview.subject}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowText(false)}
                className={cn(
                  'rounded px-2 py-0.5 text-xs transition-colors',
                  !showText ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                HTML
              </button>
              <button
                type="button"
                onClick={() => setShowText(true)}
                className={cn(
                  'rounded px-2 py-0.5 text-xs transition-colors',
                  showText ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Text
              </button>
            </div>
          </div>
          <div className="relative min-h-[360px]">
            {loadingPreview ? (
              <div className="flex h-[360px] items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : preview ? (
              showText ? (
                <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs text-muted-foreground">
                  {preview.text}
                </pre>
              ) : (
                <iframe
                  ref={iframeRef}
                  title="Email preview"
                  className="h-[480px] w-full border-0 bg-white"
                  sandbox=""
                />
              )
            ) : (
              <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
                Выберите шаблон для предпросмотра
              </div>
            )}
          </div>
        </div>

        {/* Тестовая отправка */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Send className="size-3.5 text-muted-foreground" />
            Тестовая отправка
          </h3>
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="test-email-recipient">Email получателя</Label>
              <Input
                id="test-email-recipient"
                type="email"
                placeholder="test@example.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSend();
                }}
              />
            </div>
            <Button
              onClick={() => void handleSend()}
              disabled={sending || !selected || !recipientEmail.trim()}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Отправить
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Письмо будет отправлено с демо-данными через настроенный SMTP. Если SMTP не настроен, письмо будет залогировано в консоль сервера.
          </p>
        </div>
      </div>
    </div>
  );
}

function ListSkeleton(): React.ReactElement {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
