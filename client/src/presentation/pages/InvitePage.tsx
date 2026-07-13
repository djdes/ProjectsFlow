import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { HttpError } from '@/lib/HttpError';
import type { InvitePreview } from '@/domain/invite/InvitePreview';

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

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md space-y-5 rounded-xl border bg-card p-7 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Приглашение</h1>

        {state.status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Загружаем…
          </div>
        )}

        {state.status === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button asChild variant="outline">
              <Link to="/">На&nbsp;главную</Link>
            </Button>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <div className="space-y-2 text-sm">
              <p>
                Тебя приглашают в {state.preview.kind === 'workspace' ? 'пространство' : 'проект'}{' '}
                <span className="font-semibold">«{state.preview.targetName}»</span> с правами{' '}
                <span className="font-semibold">{ROLE_LABEL[state.preview.role]}</span>.
              </p>
              {state.preview.kind === 'workspace' && (
                <p className="text-muted-foreground">
                  Доступ — ко всем проектам пространства, включая будущие.
                </p>
              )}
              {state.preview.inviterDisplayName && (
                <p className="text-muted-foreground">
                  Пригласил: {state.preview.inviterDisplayName}
                </p>
              )}
              {state.preview.inviteEmail && (
                <p className="text-muted-foreground">
                  Email в приглашении: {state.preview.inviteEmail}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Действительно до {state.preview.expiresAt.toLocaleString('ru-RU')}
              </p>
            </div>

            {status === 'authenticated' ? (
              <div className="flex gap-2">
                <Button onClick={() => void accept()} disabled={accepting}>
                  {accepting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Принять
                </Button>
                <Button variant="ghost" asChild>
                  <Link to="/">Отказаться</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Чтобы принять приглашение, нужно войти или зарегистрироваться.
                </p>
                <div className="flex gap-2">
                  <Button onClick={goToLogin}>Войти</Button>
                  <Button variant="outline" asChild>
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
          </>
        )}
      </div>
    </div>
  );
}
