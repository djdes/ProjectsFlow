import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/presentation/auth/PasswordInput';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
import { ErrorNote } from '@/presentation/pages/PageScaffold';
import { useContainer } from '@/infrastructure/di/container';
import { HttpError } from '@/lib/HttpError';

// Установка нового пароля по ссылке из письма (/reset-password?token=…). Токен одноразовый
// и с TTL — сервер валидирует. После успеха уводим на /login.
export function ResetPasswordPage(): React.ReactElement {
  const { authRepository } = useContainer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Токена нет в ссылке — сразу честно об этом.
  if (!token) {
    return (
      <AuthFormCard
        title="Ссылка недействительна"
        description="В ссылке нет токена сброса. Запросите новую ссылку."
        footer={
          <Link to="/forgot-password" className="font-medium text-primary-ink hover:underline">
            Запросить сброс заново
          </Link>
        }
      />
    );
  }

  if (done) {
    return (
      <AuthFormCard
        title="Пароль обновлён"
        description="Теперь войдите с новым паролем."
        footer={
          <Link to="/login" className="font-medium text-primary-ink hover:underline">
            Перейти ко входу
          </Link>
        }
      >
        <Button size="lg" className="w-full" onClick={() => navigate('/login', { replace: true })}>
          Войти
        </Button>
      </AuthFormCard>
    );
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Пароль минимум 8 символов');
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setSubmitting(true);
    try {
      await authRepository.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 410 || err.status === 400)) {
        setError('Ссылка сброса недействительна или истекла — запросите новую.');
      } else {
        setError('Не удалось сменить пароль. Попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFormCard
      title="Новый пароль"
      description="Придумайте новый пароль для входа."
      footer={
        <Link to="/login" className="font-medium text-primary-ink hover:underline">
          Вернуться ко входу
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Новый пароль</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            autoFocus
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Минимум 8 символов.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">Повторите пароль</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? 'Сохраняем…' : 'Сменить пароль'}
        </Button>
      </form>
    </AuthFormCard>
  );
}
