import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/presentation/auth/PasswordInput';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { AuthFormCard, authFieldClass } from '@/presentation/auth/AuthFormCard';
import { ErrorNote } from '@/presentation/pages/PageScaffold';
import { InvalidCredentialsError } from '@/domain/user/errors';
import { goToPostAuthTarget, safeNextTarget } from '@/lib/authRedirect';

type LocationState = { from?: string };

export function LoginPage(): React.ReactElement {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Цель возврата: ?next= (в т.ч. абсолютный URL с поддомена доски) → state.from → «/».
  const nextParam = new URLSearchParams(location.search).get('next');
  const target = safeNextTarget(nextParam) ?? (location.state as LocationState | null)?.from ?? '/';

  // Уже авторизован (например, вернулся на /login) — уводим на цель. Через эффект,
  // т.к. цель может быть абсолютной (cross-origin), а <Navigate> так не умеет.
  useEffect(() => {
    if (status === 'authenticated') goToPostAuthTarget(target, navigate);
  }, [status, target, navigate]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      goToPostAuthTarget(target, navigate);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        setError('Неверный email или пароль');
      } else {
        setError('Не удалось войти. Попробуй ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Авторизован — не мигаем формой, пока эффект уводит на цель.
  if (status === 'authenticated') {
    return <div className="grid h-dvh place-items-center bg-background" />;
  }

  return (
    <AuthFormCard
      title="Вход"
      description="Войди в ProjectsFlow, чтобы открыть свои проекты."
      footer={
        <>
          Нет аккаунта?{' '}
          <Link to="/register" className="font-medium text-primary-ink hover:underline">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            className={authFieldClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Пароль</Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? 'Входим…' : 'Войти'}
        </Button>
        <p className="text-center text-ui">
          <Link to="/forgot-password" className="font-medium text-primary-ink hover:underline">
            Забыли пароль?
          </Link>
        </p>
      </form>
    </AuthFormCard>
  );
}
