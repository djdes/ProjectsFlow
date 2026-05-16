import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { AuthFormCard } from '@/presentation/auth/AuthFormCard';
import { useContainer } from '@/infrastructure/di/container';
import { MagicLinkRateLimitedError } from '@/domain/user/errors';

export function LoginPage(): React.ReactElement {
  const { status } = useAuth();
  const { authRepository } = useContainer();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; devUrl: string | null } | null>(null);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { devMagicUrl } = await authRepository.requestMagicLink({ email });
      setSent({ email, devUrl: devMagicUrl });
    } catch (err) {
      if (err instanceof MagicLinkRateLimitedError) {
        setError(`Слишком много запросов. Подожди ~${Math.ceil(err.retryAfterSeconds / 60)} мин.`);
      } else {
        setError('Не удалось отправить ссылку. Попробуй ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthFormCard
        title="Проверь почту"
        description={`Отправили ссылку на ${sent.email}. Открой её, чтобы войти.`}
        footer={
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setSent(null)}
          >
            Указать другой email
          </button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Ссылка действует 15&nbsp;минут и работает один раз. Не пришла — загляни в спам.
          </p>
          {sent.devUrl && (
            <div className="space-y-1.5 rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs">
              <p className="font-medium text-foreground">Dev: ссылка из лога</p>
              <a
                href={sent.devUrl}
                className="break-all font-mono text-[11px] text-primary hover:underline"
              >
                {sent.devUrl}
              </a>
            </div>
          )}
        </div>
      </AuthFormCard>
    );
  }

  return (
    <AuthFormCard
      title="Вход"
      description="Введи email — пришлём ссылку для входа. Без паролей."
      footer={
        <span>
          Нет аккаунта? Просто введи email — мы создадим его автоматически.
        </span>
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
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Отправляем…' : 'Прислать ссылку'}
        </Button>
      </form>
    </AuthFormCard>
  );
}
