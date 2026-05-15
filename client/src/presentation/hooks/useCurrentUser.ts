import type { User } from '@/domain/user/User';
import { useAuth } from '@/presentation/auth/AuthProvider';

/**
 * Возвращает текущего user'а. Под ProtectedRoute user всегда есть,
 * но интерфейс остаётся {user|null,loading,error} чтобы потребители
 * (SidebarUserMenu, ProfilePage) не ломались на момент маунта.
 */
export function useCurrentUser(): {
  user: User | null;
  loading: boolean;
  error: Error | null;
} {
  const { user, status } = useAuth();
  return {
    user,
    loading: status === 'loading',
    error: null,
  };
}
