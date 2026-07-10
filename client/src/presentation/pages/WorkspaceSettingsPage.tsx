import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { WorkspaceRole } from '@/domain/workspace/Workspace';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useRenameWorkspace } from '@/presentation/hooks/useRenameWorkspace';
import { useDeleteWorkspace } from '@/presentation/hooks/useDeleteWorkspace';
import { useWorkspaceMembers } from '@/presentation/hooks/useWorkspaceMembers';
import { useWorkspaceProjects } from '@/presentation/hooks/useWorkspaceProjects';
import { EmojiGrid } from '@/presentation/components/forms/EmojiGrid';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';

const ROLE_SELECT_CLASS =
  'h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function WorkspaceSettingsPage(): React.ReactElement {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { data: workspaces, loading } = useWorkspaces();

  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null;
  const isOwner = workspace?.role === 'owner';
  // Дефолт-хаб: состав участников выводится автоматически (вы + все по общим проектам),
  // и его нельзя удалить. Поэтому ручное управление участниками и «опасная зона» скрыты.
  const isDefault = workspace?.kind === 'default';

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="h-40 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1">
          <Link to="/">
            <ArrowLeft />
            На&nbsp;главную
          </Link>
        </Button>
        <p className="text-muted-foreground">Пространство не&nbsp;найдено или у&nbsp;вас нет доступа.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-12 pt-3.5 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1">
        <Link to="/">
          <ArrowLeft />
          Назад
        </Link>
      </Button>

      <div className="flex items-center gap-3">
        <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="size-9 text-base" />
        <h1 className="text-xl font-semibold tracking-tight">{workspace.name}</h1>
      </div>

      <RenameCard workspaceId={workspace.id} initialName={workspace.name} initialIcon={workspace.icon} disabled={!isOwner} />
      <MembersCard workspaceId={workspace.id} canManage={isOwner && !isDefault} autoManaged={isDefault} />
      <ProjectsCard workspaceId={workspace.id} />
      {isOwner && !isDefault && (
        <DangerZoneCard
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          projectCount={workspace.projectCount}
          isLast={(workspaces?.length ?? 1) <= 1}
          onDeleted={() => navigate('/')}
        />
      )}
    </div>
  );
}

function RenameCard({
  workspaceId,
  initialName,
  initialIcon,
  disabled,
}: {
  workspaceId: string;
  initialName: string;
  initialIcon: string | null;
  disabled: boolean;
}): React.ReactElement {
  const { submit, saving } = useRenameWorkspace();
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<string | null>(initialIcon);

  useEffect(() => {
    setName(initialName);
    setIcon(initialIcon);
  }, [initialName, initialIcon]);

  const trimmed = name.trim();
  const dirty = trimmed !== initialName || icon !== initialIcon;

  const save = async (): Promise<void> => {
    try {
      await submit(workspaceId, { name: trimmed, icon });
      toast.success('Пространство обновлено');
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось сохранить');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Название и&nbsp;иконка</CardTitle>
        <CardDescription>Видны в&nbsp;переключателе пространств.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <WorkspaceIcon name={trimmed || '?'} icon={icon} className="size-11 text-lg" />
          <div className="flex-1 space-y-2">
            <Label htmlFor="wsName">Название</Label>
            <Input
              id="wsName"
              value={name}
              maxLength={120}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        {!disabled && (
          <>
            <EmojiGrid value={icon} onChange={setIcon} />
            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving || !dirty || trimmed.length === 0}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MembersCard({
  workspaceId,
  canManage,
  autoManaged = false,
}: {
  workspaceId: string;
  canManage: boolean;
  // Дефолт-хаб: состав выводится автоматически, ручное управление скрыто.
  autoManaged?: boolean;
}): React.ReactElement {
  const { members, loading, add, changeRole, remove } = useWorkspaceMembers(workspaceId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await add(trimmed, role);
      setEmail('');
      toast.success('Участник добавлен');
    } catch (err) {
      toast.error((err as Error).message || 'Не удалось добавить участника');
    } finally {
      setAdding(false);
    }
  };

  const handleRole = async (userId: string, next: WorkspaceRole): Promise<void> => {
    try {
      await changeRole(userId, next);
    } catch (err) {
      toast.error((err as Error).message || 'Не удалось сменить роль');
    }
  };

  // Подтверждение удаления участника (U7): раньше — удаление одним кликом по корзине.
  const [pendingRemove, setPendingRemove] = useState<{ userId: string; label: string } | null>(
    null,
  );

  const handleRemove = async (userId: string): Promise<void> => {
    try {
      await remove(userId);
    } catch (err) {
      toast.error((err as Error).message || 'Не удалось удалить участника');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Участники</CardTitle>
        <CardDescription>
          {autoManaged
            ? 'Это пространство по умолчанию. Состав формируется автоматически: вы и все, с кем у вас есть общие проекты.'
            : 'Доступ к пространству и его проектам.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="h-16 animate-pulse rounded bg-muted" />
        ) : (
          <ul className="divide-y">
            {(members ?? []).map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2">
                <Avatar className="size-8">
                  <AvatarFallback className={avatarColor(m.displayName ?? m.email)}>
                    {getInitials(m.displayName ?? m.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.displayName ?? '—'}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                {canManage ? (
                  <>
                    <select
                      className={ROLE_SELECT_CLASS}
                      value={m.role}
                      onChange={(e) => void handleRole(m.userId, e.target.value as WorkspaceRole)}
                      aria-label="Роль участника"
                    >
                      <option value="owner">Владелец</option>
                      <option value="member">Участник</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingRemove({
                          userId: m.userId,
                          label: m.displayName ?? m.email ?? 'участника',
                        })
                      }
                      aria-label="Удалить участника"
                      title="Удалить"
                      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {m.role === 'owner' ? 'Владелец' : 'Участник'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="memberEmail">Добавить по&nbsp;email</Label>
              <Input
                id="memberEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
            <select
              className={ROLE_SELECT_CLASS}
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              aria-label="Роль нового участника"
            >
              <option value="member">Участник</option>
              <option value="owner">Владелец</option>
            </select>
            <Button type="submit" disabled={adding || email.trim().length === 0}>
              {adding ? 'Добавляем…' : 'Добавить'}
            </Button>
          </form>
        )}
      </CardContent>

      <Dialog open={pendingRemove !== null} onOpenChange={(o) => !o && setPendingRemove(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить участника?</DialogTitle>
            <DialogDescription>
              {pendingRemove ? (
                <>
                  <span className="font-medium text-foreground">{pendingRemove.label}</span> потеряет
                  доступ к пространству и его проектам. Действие можно отменить, снова пригласив
                  участника.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = pendingRemove?.userId;
                setPendingRemove(null);
                if (id) void handleRemove(id);
              }}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProjectsCard({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { projects, loading, move } = useWorkspaceProjects(workspaceId);
  const { data: workspaces } = useWorkspaces();
  const targets = (workspaces ?? []).filter((w) => w.id !== workspaceId);

  const handleMove = async (projectId: string, targetId: string): Promise<void> => {
    if (!targetId) return;
    try {
      await move(projectId, targetId);
      toast.success('Проект перенесён');
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось перенести проект');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Проекты</CardTitle>
        <CardDescription>Проекты этого пространства. Перенос — только для&nbsp;владельца проекта.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-16 animate-pulse rounded bg-muted" />
        ) : (projects?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">В&nbsp;пространстве пока нет проектов.</p>
        ) : (
          <ul className="divide-y">
            {(projects ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <WorkspaceIcon name={p.name} icon={p.icon} className="size-6" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                {targets.length > 0 && (
                  <select
                    className={ROLE_SELECT_CLASS}
                    defaultValue=""
                    onChange={(e) => {
                      const target = e.target.value;
                      e.target.value = '';
                      void handleMove(p.id, target);
                    }}
                    aria-label={`Перенести проект «${p.name}»`}
                  >
                    <option value="" disabled>
                      Перенести в…
                    </option>
                    {targets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DangerZoneCard({
  workspaceId,
  workspaceName,
  projectCount,
  isLast,
  onDeleted,
}: {
  workspaceId: string;
  workspaceName: string;
  projectCount: number;
  isLast: boolean;
  onDeleted: () => void;
}): React.ReactElement {
  const { submit, saving } = useDeleteWorkspace();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const blockedReason =
    projectCount > 0
      ? 'Сначала перенесите или удалите проекты пространства.'
      : isLast
        ? 'Нельзя удалить единственное пространство.'
        : null;

  const doDelete = async (): Promise<void> => {
    try {
      await submit(workspaceId);
      toast.success('Пространство удалено');
      setConfirmOpen(false);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось удалить пространство');
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Опасная зона</CardTitle>
        <CardDescription>Удаление пространства необратимо.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          variant="outline"
          className={cn('gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive')}
          disabled={blockedReason !== null}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-4" />
          Удалить пространство
        </Button>
        {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить «{workspaceName}»?</DialogTitle>
            <DialogDescription>
              Пространство будет удалено безвозвратно. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="outline"
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={saving}
              onClick={() => void doDelete()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
