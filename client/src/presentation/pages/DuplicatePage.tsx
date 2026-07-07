import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';

// Страница «Дублировать публичную доску в свой аккаунт» (на апекс-домене приложения).
// Кнопка «Дублировать» на публичной доске ведёт сюда: /duplicate?slug=<slug>.
// Не залогинен → на регистрацию (после — вернёмся сюда и склонируем). Залогинен → клон →
// редирект на новый проект.
export function DuplicatePage(): React.ReactElement {
  const [params] = useSearchParams();
  const slug = params.get('slug') ?? '';
  const { publicBoardRepository } = useContainer();
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (loading || startedRef.current) return;
    if (!slug) {
      setError('Не указана доска для копирования.');
      return;
    }
    if (!user) {
      // Не залогинен → регистрация, после успеха RegisterPage вернёт на state.from (сюда).
      navigate('/register', {
        state: { from: `/duplicate?slug=${encodeURIComponent(slug)}` },
        replace: true,
      });
      return;
    }
    startedRef.current = true;
    publicBoardRepository
      .clone(slug)
      .then((r) => navigate(`/projects/${r.projectId}`, { replace: true }))
      .catch(() =>
        setError('Не удалось скопировать доску. Возможно, она больше не опубликована.'),
      );
  }, [loading, user, slug, publicBoardRepository, navigate]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      {error ? (
        <div className="max-w-sm text-center">
          <p className="text-sm text-foreground">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            На главную
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Копируем доску в ваш ProjectsFlow…</p>
        </div>
      )}
    </div>
  );
}
