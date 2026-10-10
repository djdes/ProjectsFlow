import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { HttpError } from '@/lib/HttpError';
import type { InvitePreview } from '@/domain/invite/InvitePreview';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
import { ErrorNote } from '@/presentation/pages/PageScaffold';

const ROLE_LABEL: Record<'editor' | 'viewer', string> = {
  editor: 'редактор',
  viewer: 'наблюдатель',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; preview: InvitePreview }
  | { status: 'error'; message: string };

// Анонимная страница: открывается по `/invite/:token`. Если юзер не залогинен — показывает
// preview и кнопку «Войти, чтобы принять» (после логина роутер вернёт сюда). Залогиненный
// юзер видит preview + кнопки accept/decline. Decline просто уводит на / (токен не
// помечается — его всё ещё можно accept'ить, если передумает).
export function InvitePage(): React.ReactElement {
  const { token } = useParams<{ token: string }>();
  const { inviteRepository } = useContainer();
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    inviteRepository
      .getPreview(token)
      .then((preview) => {
        if (!cancelled) setState({ status: 'ready', preview });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          e instanceof HttpError && e.status === 404
            ? 'Приглашение не найдено или ссылка некорректна.'
            : e instanceof HttpError && e.status === 410
              ? 'Приглашение больше не действительно (истекло или уже использовано).'
              : `Не удалось загрузить приглашение: ${(e as Error).message}`;
        setState({ status: 'error', message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [token, inviteRepository]);

  const accept = async (): Promise<void> => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await inviteRepository.accept(token);
      if (res.projectId) {
        // Legacy project-токен: accept зачислил в пространство проекта — ведём на проект.
        toast.success('Вы добавлены в проект');
        navigate(`/projects/${res.projectId}`, { replace: true });
      } else {
        toast.success('Вы присоединились к пространству');
        navigate('/', { replace: true });
      }
    } catch (e) {
      const msg =
        e instanceof HttpError && e.status === 410
          ? 'Приглашение больше не действительно.'
          : `Не удалось принять: ${(e as Error).message}`;
      toast.error(msg);
    } finally {
      setAccepting(false);
    }
  };

  const goToLogin = (): void => {
    navigate('/login', {
      state: { from: location.pathname },
      replace: true,
    });
  };

  // Тот же экран, что у входа и регистрации: приглашение открывают по ссылке до логина.
  return (
    <AuthFormCard title="Приглашение">
      {state.status === 'loading' && (
        <LoadingRegion label="Загружаем приглашение…">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mbs-2 h-12 w-full sm:h-9" />
          </div>
        </LoadingRegion>
      )}

      {state.status === 'error' && (
        <div className="flex flex-col gap-4">
          <ErrorNote>{state.message}</ErrorNote>
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link to="/">На&nbsp;главную</Link>
          </Button>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Тебя приглашают в {state.preview.kind === 'workspace' ? 'пространство' : 'проект'}{' '}
              <span className="font-semibold">«{state.preview.targetName}»</span> с правами{' '}
              <span className="font-semibold">{ROLE_LABEL[state.preview.role]}</span>.
            </p>
            <div className="flex flex-col gap-1.5 rounded-xl bg-panel px-4 py-3 text-ui text-muted-foreground">
              {state.preview.kind === 'workspace' && (
                <p>
                  Вам будут доступны выбранные для вас проекты пространства. Доступ меняет владелец или руководитель.
                </p>
              )}
              {state.preview.inviterDisplayName && (
                <p>Пригласил: {state.preview.inviterDisplayName}</p>
              )}
              {state.preview.inviteEmail && (
                <p>Email в приглашении: {state.preview.inviteEmail}</p>
              )}
              <p className="text-xs">
                Действительно до {state.preview.expiresAt.toLocaleString('ru-RU')}
              </p>
            </div>
          </div>

          {status === 'authenticated' ? (
            <div className="flex gap-2">
              <Button size="lg" className="flex-1" onClick={() => void accept()} disabled={accepting}>
                {accepting ? <Loader2 className="size-4 motion-safe:animate-spin" /> : null}
                Принять
              </Button>
              <Button variant="ghost" size="lg" asChild>
                <Link to="/">Отказаться</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Чтобы принять приглашение, нужно войти или зарегистрироваться.
              </p>
              <div className="flex gap-2">
                <Button size="lg" className="flex-1" onClick={goToLogin}>
                  Войти
                </Button>
                <Button variant="outline" size="lg" className="flex-1" asChild>
                  <Link
                    to="/register"
                    state={{ from: location.pathname }}
                  >
                    Регистрация
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </AuthFormCard>
  );
}
