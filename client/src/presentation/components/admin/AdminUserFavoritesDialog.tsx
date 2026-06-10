import { useCallback, useEffect, useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { AdminUser, AdminUserProjectFavorite } from '@/application/admin/AdminRepository';

type Props = {
  user: AdminUser;
  onClose: () => void;
};

// Admin-управление избранным в проектах конкретного юзера. Открывается из AdminPage по
// кнопке «Избранное». Показывает проекты юзера (любые роли, кроме inbox) с отметкой
// «в избранном» — admin добавляет/убирает избранное ЗА этого юзера. Inbox сервер не
// отдаёт (favorite'ить его нельзя).
export function AdminUserFavoritesDialog({ user, onClose }: Props): React.ReactElement {
  const { adminRepository } = useContainer();
  const [projects, setProjects] = useState<AdminUserProjectFavorite[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): void => {
    adminRepository
      .listUserProjectsWithFavorites(user.id)
      .then(setProjects)
      .catch((e: unknown) => setError((e as Error).message ?? 'Не удалось загрузить'));
  }, [adminRepository, user.id]);

  useEffect(load, [load]);

  const setFavoriteLocal = (projectId: string, favorite: boolean): void => {
    setProjects((prev) =>
      prev?.map((p) => (p.projectId === projectId ? { ...p, isFavorite: favorite } : p)) ?? prev,
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="size-5 text-muted-foreground" />
            Избранное {user.displayName}
          </DialogTitle>
          <DialogDescription>
            Проекты, в которых участвует {user.displayName}. Отметь звёздочкой те, что должны
            попасть в его раздел «Избранное» в сайдбаре.
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
            У {user.displayName} нет проектов для избранного.
          </p>
        )}

        {projects !== null && projects.length > 0 && (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border bg-card">
            {projects.map((p) => (
              <FavoriteRow
                key={p.projectId}
                project={p}
                userId={user.id}
                onChanged={(fav) => setFavoriteLocal(p.projectId, fav)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Строка проекта с переключателем избранного. Оптимистично переключает локально, откат
// при ошибке. Saving-стейт локальный — каждая строка независима.
function FavoriteRow({
  project,
  userId,
  onChanged,
}: {
  project: AdminUserProjectFavorite;
  userId: string;
  onChanged: (favorite: boolean) => void;
}): React.ReactElement {
  const { adminRepository } = useContainer();
  const [saving, setSaving] = useState(false);

  const toggle = async (): Promise<void> => {
    const next = !project.isFavorite;
    setSaving(true);
    onChanged(next);
    try {
      await adminRepository.setUserProjectFavorite(userId, project.projectId, next);
      toast.success(next ? 'Добавлено в избранное' : 'Убрано из избранного');
    } catch (e) {
      onChanged(!next);
      toast.error((e as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{project.projectName}</p>
      <Button
        size="sm"
        variant={project.isFavorite ? 'default' : 'outline'}
        onClick={() => void toggle()}
        disabled={saving}
        className="gap-1.5"
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Star className={cn('size-3.5', project.isFavorite && 'fill-current')} />
        )}
        {project.isFavorite ? 'В избранном' : 'Добавить'}
      </Button>
    </li>
  );
}
