import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AppShell } from '@/presentation/layout/AppShell';
import { ProjectPage } from '@/presentation/pages/ProjectPage';
import { KbPage } from '@/presentation/pages/KbPage';
import { TasksPage } from '@/presentation/pages/TasksPage';
import { InboxPage } from '@/presentation/pages/InboxPage';
import { NotificationsPage } from '@/presentation/pages/NotificationsPage';
import { ProfilePage } from '@/presentation/pages/ProfilePage';
import { FinancePage } from '@/presentation/pages/FinancePage';
import { AdminPage } from '@/presentation/pages/AdminPage';
import { NotFoundPage } from '@/presentation/pages/NotFoundPage';
import { LoginPage } from '@/presentation/pages/LoginPage';
import { RegisterPage } from '@/presentation/pages/RegisterPage';
import { DevicePage } from '@/presentation/pages/DevicePage';
import { InvitePage } from '@/presentation/pages/InvitePage';
import { ProtectedRoute } from '@/presentation/auth/ProtectedRoute';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';

// Доска переехала с /projects/:id/tasks на /projects/:id. Старые ссылки
// (например, из уведомлений) редиректим на новый «дом» проекта.
function LegacyTasksRedirect(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId}`} replace />;
}

// Гард admin-раздела: не-админа уводим на главную. Сервер всё равно отдаёт 403.
function AdminOnly({ children }: { children: React.ReactElement }): React.ReactElement {
  const { user, loading } = useCurrentUser();
  if (loading) return <></>;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return children;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  // /invite/:token — anon-доступная страница. Внутри сам решает, что показать
  // (preview + accept или редирект на /login через state.from).
  { path: '/invite/:token', element: <InvitePage /> },
  {
    path: '/device',
    element: (
      <ProtectedRoute>
        <DevicePage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      // Главная после авторизации — «Входящие» (inbox). HomePage («Выберите проект»)
      // больше не используется как индекс.
      { index: true, element: <InboxPage /> },
      // Старые ссылки на /inbox редиректим на канонический «/».
      { path: 'inbox', element: <Navigate to="/" replace /> },
      { path: 'notifications', element: <NotificationsPage /> },
      // Доска задач — «дом» проекта: при входе сразу показываем kanban.
      { path: 'projects/:projectId', element: <TasksPage /> },
      // Обзор/настройки проекта (git, KB, команда) переехали на отдельный роут.
      { path: 'projects/:projectId/overview', element: <ProjectPage /> },
      { path: 'projects/:projectId/kb', element: <KbPage /> },
      { path: 'projects/:projectId/finance', element: <FinancePage /> },
      // Обратная совместимость со старыми ссылками на доску (напр. из уведомлений).
      { path: 'projects/:projectId/tasks', element: <LegacyTasksRedirect /> },
      { path: 'profile', element: <ProfilePage /> },
      {
        path: 'admin',
        element: (
          <AdminOnly>
            <AdminPage />
          </AdminOnly>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
