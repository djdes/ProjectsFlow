import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
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
          Нет аккаунта? <Link to="/register" className="font-medium text-primary hover:underline">Зарегистрироваться</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Пароль</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Входим…' : 'Войти'}
        </Button>
        {/* Самообслуживаемого сброса пароля пока нет — честная подсказка вместо
            битой ссылки. Восстановление доступа — через администратора/поддержку. */}
        <p className="text-center text-xs text-muted-foreground">
          Забыли пароль? Напишите в поддержку для восстановления доступа.
        </p>
      </form>
    </AuthFormCard>
  );
}
