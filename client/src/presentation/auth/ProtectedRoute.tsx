import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

type Props = {
  children: React.ReactNode;
};

export function ProtectedRoute({ children }: Props): React.ReactElement | null {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    // Не светим скелетон сразу — auth-check обычно быстрый. Пустой контейнер.
    return <div className="grid h-dvh place-items-center bg-background" />;
  }

  if (status === 'anonymous') {
    // Сохраняем полный адрес (путь + query + hash), чтобы дип-линк вида
    // /admin?tab=support вернулся целиком после логина.
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return <>{children}</>;
}
