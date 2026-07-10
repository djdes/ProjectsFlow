import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
import { UserEmailAlreadyExistsError } from '@/domain/user/errors';
import { goToPostAuthTarget, safeNextTarget } from '@/lib/authRedirect';

type LocationState = { from?: string };

export function RegisterPage(): React.ReactElement {
  const { status, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextParam = new URLSearchParams(location.search).get('next');
  const target = safeNextTarget(nextParam) ?? (location.state as LocationState | null)?.from ?? '/';

  useEffect(() => {
    if (status === 'authenticated') goToPostAuthTarget(target, navigate);
  }, [status, target, navigate]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Пароль минимум 8 символов');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register({ email, displayName, password });
      goToPostAuthTarget(target, navigate);
    } catch (err) {
      if (err instanceof UserEmailAlreadyExistsError) {
        setError('Email уже занят');
      } else {
        setError('Не удалось создать аккаунт. Попробуй ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'authenticated') {
    return <div className="grid h-dvh place-items-center bg-background" />;
  }

  return (
    <AuthFormCard
      title="Регистрация"
      description="Создай аккаунт — у тебя появится свой набор проектов."
      footer={
        <>
          Уже есть аккаунт? <Link to="/login" className="font-medium text-primary hover:underline">Войти</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Имя</Label>
          <Input
            id="displayName"
            autoComplete="name"
            autoFocus
            required
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Минимум 8 символов.</p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Создаём…' : 'Создать аккаунт'}
        </Button>
      </form>
    </AuthFormCard>
  );
}
