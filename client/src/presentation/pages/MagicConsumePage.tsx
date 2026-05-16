import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { useContainer } from '@/infrastructure/di/container';
import {
  MagicTokenConsumedError,
  MagicTokenExpiredError,
  MagicTokenInvalidError,
} from '@/domain/user/errors';

type State =
  | { kind: 'consuming' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export function MagicConsumePage(): React.ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { authRepository } = useContainer();
  const { adoptUser } = useAuth();
  const [state, setState] = useState<State>(token ? { kind: 'consuming' } : {
    kind: 'error',
    message: 'Не нашли токен в адресе. Открой ссылку из письма ещё раз.',
  });
  // StrictMode зовёт effect дважды — токен одноразовый, второй вызов уйдёт в consumed.
  // Защищаемся ref'ом.
  const consumedRef = useRef(false);

  useEffect(() => {
    if (state.kind !== 'consuming' || consumedRef.current) return;
    consumedRef.current = true;

    let cancelled = false;
    authRepository
      .consumeMagicLink({ token })
      .then((user) => {
        if (cancelled) return;
        adoptUser(user);
        setState({ kind: 'success' });
        navigate('/', { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MagicTokenInvalidError) {
          setState({ kind: 'error', message: 'Ссылка недействительна.' });
        } else if (err instanceof MagicTokenExpiredError) {
          setState({ kind: 'error', message: 'Срок действия ссылки истёк. Запроси новую.' });
        } else if (err instanceof MagicTokenConsumedError) {
          setState({ kind: 'error', message: 'Эта ссылка уже была использована.' });
        } else {
          console.error('[MagicConsumePage] consume failed:', err);
          setState({ kind: 'error', message: 'Что-то пошло не так. Попробуй ещё раз.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.kind, token, authRepository, adoptUser, navigate]);

  if (state.kind === 'consuming') {
    return (
      <AuthFormCard
        title="Входим…"
        description="Проверяем ссылку и заводим сессию."
        footer={<span>Не закрывай вкладку.</span>}
      >
        <div className="grid place-items-center py-6">
          <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      </AuthFormCard>
    );
  }

  if (state.kind === 'success') {
    return (
      <AuthFormCard
        title="Готово"
        description="Перенаправляем в приложение…"
        footer={null}
      >
        <div />
      </AuthFormCard>
    );
  }

  return (
    <AuthFormCard
      title="Не получилось"
      description={state.message}
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Запросить новую ссылку
        </Link>
      }
    >
      <div />
    </AuthFormCard>
  );
}
