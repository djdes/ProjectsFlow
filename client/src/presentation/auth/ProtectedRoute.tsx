import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { AppShellSkeleton, RouteSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { Button } from '@/components/ui/button';

type Props = {
  children: React.ReactNode;
};

export function ProtectedRoute({ children }: Props): React.ReactElement | null {
  const { status, retrySession } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return location.pathname === '/device' ? <RouteSkeleton /> : <AppShellSkeleton />;
  }

  if (status === 'anonymous') {
    // Сохраняем полный адрес (путь + query + hash), чтобы дип-линк вида
    // /admin?tab=support вернулся целиком после логина.
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (status === 'unavailable') {
    return (
      <div className="grid min-h-dvh place-items-center bg-background px-6">
        <div role="alert" className="max-w-sm text-center">
          <h1 className="text-h1 font-bold leading-tight tracking-[-0.01em]">Не удалось проверить соединение</h1>
          <p className="mbs-2 text-sm text-muted-foreground">Проверьте интернет и попробуйте ещё раз. После восстановления сети проверим доступ снова.</p>
          <Button size="lg" className="mbs-5" onClick={() => { void retrySession(); }}>Повторить</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
