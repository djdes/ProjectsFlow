import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
import { InvalidCredentialsError } from '@/domain/user/errors';

type LocationState = { from?: string };

export function LoginPage(): React.ReactElement {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') {
    // Если был state.from (например, пришёл с /invite/:token) — уважаем его,
    // иначе на главную.
    const target = (location.state as LocationState | null)?.from ?? '/';
    return <Navigate to={target} replace />;
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      const target = (location.state as LocationState | null)?.from ?? '/';
      navigate(target, { replace: true });
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
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Входим…' : 'Войти'}
        </Button>
      </form>
    </AuthFormCard>
  );
}
