import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Shield, FolderGit2, GitCommitHorizontal, Users } from 'lucide-react';
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
import type { AdminProject, AdminUser } from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';
import { getInitials } from '@/presentation/layout/projectIcons';
import { AdminUserDispatchersDialog } from '@/presentation/components/admin/AdminUserDispatchersDialog';

type Tab = 'projects' | 'users';

export function AdminPage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('projects');

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Shield className="size-7 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">Администрирование</h1>
      </div>

      <div className="inline-flex w-fit items-center gap-0.5 rounded-md border bg-card p-0.5 text-sm">
        <TabButton active={tab === 'projects'} onClick={() => setTab('projects')}>
          <FolderGit2 className="size-4" /> Проекты
        </TabButton>
        <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
          <Users className="size-4" /> Пользователи
        </TabButton>
      </div>

      {tab === 'projects' ? <ProjectsTab /> : <UsersTab />}
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

function ProjectsTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [projects, setProjects] = useState<AdminProject[] | null>(null);

  useEffect(() => {
    adminRepository
      .listProjects()
      .then(setProjects)
      .catch((e: unknown) => toast.error(`Не удалось загрузить: ${(e as Error).message}`));
  }, [adminRepository]);

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
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
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
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function UsersTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [dispatchersUser, setDispatchersUser] = useState<AdminUser | null>(null);

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
          <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="text-[11px]">{getInitials(u.displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
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
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDispatchersUser(u)}
                title="Управление Ralph-диспетчерами в проектах этого юзера"
              >
                <Bot className="size-4" />
                Диспетчеры
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
