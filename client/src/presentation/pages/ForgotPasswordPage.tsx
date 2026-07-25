import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
import { useContainer } from '@/infrastructure/di/container';

// «Забыли пароль»: вводим email → сервер (если аккаунт есть) шлёт ссылку сброса.
// Ответ всегда одинаковый (anti-enumeration) — показываем нейтральный success-экран.
export function ForgotPasswordPage(): React.ReactElement {
  const { authRepository } = useContainer();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authRepository.requestPasswordReset(email);
      setSent(true);
    } catch {
      // Даже при сетевой ошибке не раскрываем детали — показываем тот же экран.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthFormCard
        title="Проверьте почту"
        description="Если аккаунт с таким email существует, мы отправили на него ссылку для сброса пароля. Ссылка действительна 1 час."
        footer={
          <>
            <Link to="/login" className="font-medium text-primary hover:underline">
              Вернуться ко входу
            </Link>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Не пришло письмо? Проверьте папку «Спам» или{' '}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setSent(false)}
          >
            попробуйте другой email
          </button>
          .
        </p>
      </AuthFormCard>
    );
  }

  return (
    <AuthFormCard
      title="Сброс пароля"
      description="Укажите email аккаунта — пришлём ссылку для установки нового пароля."
      footer={
        <>
          Вспомнили пароль?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Войти
          </Link>
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
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Отправляем…' : 'Отправить ссылку'}
        </Button>
      </form>
    </AuthFormCard>
  );
}
