import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Loader2, Lock, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { ProductMark } from '@/presentation/auth/AuthFormCard';
import { PageTopBar } from '@/presentation/layout/PageChrome';
import { PageMessage } from '@/presentation/pages/PageScaffold';
import { useContainer } from '@/infrastructure/di/container';
import { boardSlugFromHost, appOrigin } from '@/lib/publicBoardUrl';
import { HttpError } from '@/lib/HttpError';
import type { PublicTaskAccess } from '@/domain/public/PublicBoard';

// Каркас гейта: строка шапки C4 со знаком продукта и сообщение по центру.
function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PageTopBar>
        <a
          href="/"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-ui font-semibold transition-colors hover:bg-hover"
        >
          <ProductMark className="size-5 rounded-sm text-[9px]" />
          ProjectsFlow
        </a>
      </PageTopBar>
      {children}
    </div>
  );
}

// Ожидание (кто юзер / проверка доступа) — спиннер по центру.
function Waiting(): React.ReactElement {
  return (
    <Shell>
      <div className="grid flex-1 place-items-center" role="status">
        <Loader2 className="size-5 motion-safe:animate-spin text-muted-foreground" />
        <span className="sr-only">Загружаем…</span>
      </div>
    </Shell>
  );
}

// Значок над заголовком сообщения — нейтральная плашка.
function GateIcon({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="grid size-12 place-items-center rounded-xl bg-panel text-muted-foreground [&_svg]:size-6">
      {children}
    </span>
  );
}

// Гейт отдельной страницы задачи публичной доски (/p/:slug/t/:taskId). Контент задачи здесь
// НЕ показываем (для просмотра есть read-only окно на самой доске). Логика по авторизации:
//   аноним        → просьба зарегистрироваться;
//   участник      → редирект в полное app-окно задачи;
//   не участник   → отказ доступа «вы не в проекте».
export function PublicTaskGatePage(): React.ReactElement {
  // slug из пути (/p/:slug/t/:taskId) ИЛИ из hostname (поддомен доски, где роут /t/:taskId).
  const { slug: paramSlug, taskId } = useParams<{ slug: string; taskId: string }>();
  const slug = paramSlug ?? boardSlugFromHost() ?? undefined;
  const { status } = useAuth();
  const { publicBoardRepository } = useContainer();
  const [access, setAccess] = useState<PublicTaskAccess | 'notfound' | 'error' | 'loading'>(
    'loading',
  );
  // reloadKey — ручной ретрай при сетевой ошибке (U6): 404 ≠ сбой сети.
  const [reloadKey, setReloadKey] = useState(0);

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
      .catch((e: unknown) => {
        if (cancelled) return;
        // 404 → задача действительно не найдена; прочее (сеть/500) → ошибка с ретраем.
        setAccess(e instanceof HttpError && e.status === 404 ? 'notfound' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [status, slug, taskId, publicBoardRepository, reloadKey]);

  // Пока выясняем, кто юзер.
  if (status === 'loading') return <Waiting />;

  // Аноним → регистрация. ВАЖНО: на поддомене доски (<slug>.projectsflow.ru) роутер знает
  // только `/`, `/t/:taskId` и `*` → относительный <Link to="/login"> матчился бы на `*` и
  // показывал доску. Поэтому ведём АБСОЛЮТНОЙ ссылкой на app-origin с ?next= (возврат сюда
  // после логина). На апексе appOrigin() = текущий origin, так что путь тот же.
  if (status === 'anonymous') {
    const back = encodeURIComponent(window.location.href);
    const loginUrl = `${appOrigin()}/login?next=${back}`;
    const registerUrl = `${appOrigin()}/register?next=${back}`;
    return (
      <Shell>
        <PageMessage
          className="min-h-0 flex-1"
          icon={<GateIcon><UserPlus /></GateIcon>}
          title="Войдите, чтобы открыть задачу"
          description="Отдельная страница задачи доступна участникам проекта. Зарегистрируйтесь или войдите."
        >
          <Button asChild>
            <a href={registerUrl}>Зарегистрироваться</a>
          </Button>
          <Button asChild variant="outline">
            <a href={loginUrl}>Войти</a>
          </Button>
        </PageMessage>
      </Shell>
    );
  }

  // Залогинен — ждём результат проверки членства.
  if (access === 'loading') return <Waiting />;

  if (access === 'notfound') {
    return (
      <Shell>
        <PageMessage
          className="min-h-0 flex-1"
          title="Задача не найдена"
          description="Ссылка недействительна или проект больше не опубликован."
        />
      </Shell>
    );
  }

  if (access === 'error') {
    return (
      <Shell>
        <PageMessage
          className="min-h-0 flex-1"
          title="Не удалось загрузить"
          description="Проверьте соединение и попробуйте ещё раз."
        >
          <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            Повторить
          </Button>
        </PageMessage>
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
      <PageMessage
        className="min-h-0 flex-1"
        icon={<GateIcon><Lock /></GateIcon>}
        title="Вы не участник этого проекта"
        description="Открыть задачу отдельной страницей могут только участники проекта. Просмотреть её можно на публичной доске."
      />
    </Shell>
  );
}
