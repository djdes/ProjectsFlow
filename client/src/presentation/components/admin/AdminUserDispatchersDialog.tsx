import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type {
  AdminUser,
  AdminUserProjectDispatcher,
} from '@/application/admin/AdminRepository';
import type { DispatcherCandidate } from '@/application/project/ProjectRepository';

type Props = {
  user: AdminUser;
  onClose: () => void;
};

// Admin-управление диспетчерами в проектах конкретного юзера. Открывается из
// AdminPage по кнопке «Диспетчеры». Показывает список проектов юзера (где он owner)
// + dropdown текущего/нового диспетчера. Admin может назначить ЛЮБОГО кандидата
// (включая себя — он admin не-member, проходит проверку SetProjectDispatcher).
//
// Кандидаты загружаются точечно ПО клику на «Изменить» — лениво, чтобы не делать
// N запросов сразу для N проектов на каждом открытии диалога.
export function AdminUserDispatchersDialog({ user, onClose }: Props): React.ReactElement {
  const { adminRepository, projectRepository } = useContainer();
  const [projects, setProjects] = useState<AdminUserProjectDispatcher[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): void => {
    adminRepository
      .listUserProjectsWithDispatcher(user.id)
      .then(setProjects)
      .catch((e: unknown) => setError((e as Error).message ?? 'Не удалось загрузить'));
  }, [adminRepository, user.id]);

  useEffect(load, [load]);

  const replaceProject = (patch: AdminUserProjectDispatcher): void => {
    setProjects((prev) =>
      prev?.map((p) => (p.projectId === patch.projectId ? patch : p)) ?? prev,
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5 text-muted-foreground" />
            Диспетчеры в проектах {user.displayName}
          </DialogTitle>
          <DialogDescription>
            Список проектов, где {user.displayName} — владелец. Меняй диспетчера в любом
            из них; admin может назначить кого угодно из кандидатов (включая себя,
            даже если не member).
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {projects === null && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Загрузка проектов…
          </div>
        )}

        {projects !== null && projects.length === 0 && (
          <p className="rounded-md border border-dashed bg-muted/10 p-4 text-center text-sm text-muted-foreground">
            У {user.displayName} нет собственных проектов.
          </p>
        )}

        {projects !== null && projects.length > 0 && (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border bg-card">
            {projects.map((p) => (
              <li key={p.projectId} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.projectName}
                      {p.isInbox && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (Входящие)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Сейчас:{' '}
                      {p.dispatcherUserId === null ? (
                        <span className="italic">ручной режим</span>
                      ) : (
                        <strong className="text-foreground">
                          {p.dispatcherDisplayName ?? p.dispatcherUserId}
                        </strong>
                      )}
                    </p>
                  </div>
                </div>
                <DispatcherPicker
                  projectId={p.projectId}
                  currentDispatcherUserId={p.dispatcherUserId}
                  onChanged={(newDispatcher) => {
                    replaceProject({
                      ...p,
                      dispatcherUserId: newDispatcher.userId,
                      dispatcherDisplayName: newDispatcher.displayName,
                      dispatcherEmail: newDispatcher.email,
                    });
                  }}
                  projectRepository={projectRepository}
                />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Inline-picker для одного проекта: lazy-load кандидатов на первый клик «Изменить»,
// потом select + Сохранить.
function DispatcherPicker({
  projectId,
  currentDispatcherUserId,
  onChanged,
  projectRepository,
}: {
  projectId: string;
  currentDispatcherUserId: string | null;
  onChanged: (next: { userId: string | null; displayName: string | null; email: string | null }) => void;
  projectRepository: ReturnType<typeof useContainer>['projectRepository'];
}): React.ReactElement {
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<DispatcherCandidate[] | null>(null);
  const [draft, setDraft] = useState<string | null>(currentDispatcherUserId);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const openPicker = (): void => {
    setPicking(true);
    setDraft(currentDispatcherUserId);
    setLoadError(null);
    projectRepository.listDispatcherCandidates(projectId).then(
      setCandidates,
      (e: unknown) => setLoadError((e as Error).message ?? 'Не удалось загрузить кандидатов'),
    );
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await projectRepository.setDispatcher(projectId, draft);
      const chosen = candidates?.find((c) => c.userId === draft) ?? null;
      onChanged({
        userId: draft,
        displayName: chosen?.displayName ?? null,
        email: chosen?.email ?? null,
      });
      toast.success(draft === null ? 'Диспетчер снят' : 'Диспетчер обновлён');
      setPicking(false);
    } catch (e) {
      toast.error((e as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (!picking) {
    return (
      <Button size="sm" variant="outline" onClick={openPicker}>
        Изменить
      </Button>
    );
  }

  if (loadError) return <p className="text-xs text-destructive">{loadError}</p>;
  if (candidates === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Загрузка кандидатов…
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Нет ralph-кандидатов в этом проекте (никто из участников и админов не подключил
        agent-токен).
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={draft ?? ''}
        onChange={(e) => setDraft(e.target.value || null)}
        disabled={saving}
        className="h-8 rounded-md border bg-background px-2 text-xs"
      >
        <option value="">— ручной режим —</option>
        {candidates.map((c) => (
          <option key={c.userId} value={c.userId}>
            {c.displayName}
            {c.isAdmin ? ' (admin)' : ''}
            {!c.isMember ? ' [не member]' : ''}
            {' · '}
            {c.activeTokenCount} {c.activeTokenCount === 1 ? 'токен' : 'токенов'}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        onClick={() => void save()}
        disabled={saving || draft === currentDispatcherUserId}
      >
        {saving && <Loader2 className="size-3.5 animate-spin" />}
        Сохранить
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setPicking(false)} disabled={saving}>
        Отмена
      </Button>
    </div>
  );
}
