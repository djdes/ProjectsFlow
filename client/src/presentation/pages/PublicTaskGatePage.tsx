import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Loader2, Lock, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { useContainer } from '@/infrastructure/di/container';
import type { PublicTaskAccess } from '@/domain/public/PublicBoard';

function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="min-h-dvh bg-background">
      <div className="flex h-11 items-center justify-end border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
        <a
          href="/"
          className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ProjectsFlow
        </a>
      </div>
      <div className="mx-auto max-w-md px-6 py-24 text-center">{children}</div>
    </div>
  );
}

// Гейт отдельной страницы задачи публичной доски (/p/:slug/t/:taskId). Контент задачи здесь
// НЕ показываем (для просмотра есть read-only окно на самой доске). Логика по авторизации:
//   аноним        → просьба зарегистрироваться;
//   участник      → редирект в полное app-окно задачи;
//   не участник   → отказ доступа «вы не в проекте».
export function PublicTaskGatePage(): React.ReactElement {
  const { slug, taskId } = useParams<{ slug: string; taskId: string }>();
  const { status } = useAuth();
  const { publicBoardRepository } = useContainer();
  const [access, setAccess] = useState<PublicTaskAccess | 'notfound' | 'loading'>('loading');

  useEffect(() => {
    // Доступ спрашиваем только у залогиненного (аноним и так уходит на регистрацию).
    if (status !== 'authenticated' || !slug || !taskId) return;
    let cancelled = false;
    setAccess('loading');
    publicBoardRepository
      .getTaskAccess(slug, taskId)
      .then((a) => {
        if (!cancelled) setAccess(a ?? 'notfound');
      })
      .catch(() => {
        if (!cancelled) setAccess('notfound');
      });
    return () => {
      cancelled = true;
    };
  }, [status, slug, taskId, publicBoardRepository]);

  // Пока выясняем, кто юзер.
  if (status === 'loading') {
    return (
      <Shell>
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </Shell>
    );
  }

  // Аноним → регистрация.
  if (status === 'anonymous') {
    return (
      <Shell>
        <UserPlus className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Войдите, чтобы открыть задачу</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Отдельная страница задачи доступна участникам проекта. Зарегистрируйтесь или войдите.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button asChild>
            <Link to="/register">Зарегистрироваться</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/login">Войти</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  // Залогинен — ждём результат проверки членства.
  if (access === 'loading') {
    return (
      <Shell>
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </Shell>
    );
  }

  if (access === 'notfound') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-foreground">Задача не найдена</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ссылка недействительна или проект больше не опубликован.
        </p>
      </Shell>
    );
  }

  // Участник → в полное app-окно задачи.
  if (access.isMember) {
    return <Navigate to={`/projects/${access.projectId}/tasks/${taskId}`} replace />;
  }

  // Залогинен, но не участник → отказ доступа.
  return (
    <Shell>
      <Lock className="mx-auto mb-3 size-8 text-muted-foreground" />
      <h1 className="text-xl font-semibold text-foreground">Вы не участник этого проекта</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Открыть задачу отдельной страницей могут только участники проекта. Просмотреть её можно на
        публичной доске.
      </p>
    </Shell>
  );
}
