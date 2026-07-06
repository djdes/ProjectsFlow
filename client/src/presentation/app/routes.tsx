import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AppShell } from '@/presentation/layout/AppShell';
import { ProjectPage } from '@/presentation/pages/ProjectPage';
import { KbPage } from '@/presentation/pages/KbPage';
import { MonitoringPage } from '@/presentation/pages/MonitoringPage';
import { MonitoringOverviewPage } from '@/presentation/pages/MonitoringOverviewPage';
import { AlertCenterPage } from '@/presentation/pages/AlertCenterPage';
import { TasksPage } from '@/presentation/pages/TasksPage';
import { TaskDetailPage } from '@/presentation/pages/TaskDetailPage';
import { InboxPage } from '@/presentation/pages/InboxPage';
import { ProfilePage } from '@/presentation/pages/ProfilePage';
import { WorkspaceSettingsPage } from '@/presentation/pages/WorkspaceSettingsPage';
import { FinancePage } from '@/presentation/pages/FinancePage';
import { AdminPage } from '@/presentation/pages/AdminPage';
import { NotFoundPage } from '@/presentation/pages/NotFoundPage';
import { LoginPage } from '@/presentation/pages/LoginPage';
import { RegisterPage } from '@/presentation/pages/RegisterPage';
import { DevicePage } from '@/presentation/pages/DevicePage';
import { InvitePage } from '@/presentation/pages/InvitePage';
import { PublicBoardPage } from '@/presentation/pages/PublicBoardPage';
import { PublicTaskGatePage } from '@/presentation/pages/PublicTaskGatePage';
import { boardSlugFromHost } from '@/lib/publicBoardUrl';
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

// Notion-style поддомен доски: <slug>.projectsflow.ru. Если открыты на нём — ВЕСЬ SPA это
// публичная доска (slug берётся из hostname, не из пути). Иначе — обычное приложение.
const boardHostSlug = boardSlugFromHost();

export const router = createBrowserRouter(
  boardHostSlug
    ? [
        { path: '/', element: <PublicBoardPage /> },
        { path: '/t/:taskId', element: <PublicTaskGatePage /> },
        { path: '*', element: <PublicBoardPage /> },
      ]
    : [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  // /invite/:token — anon-доступная страница. Внутри сам решает, что показать
  // (preview + accept или редирект на /login через state.from).
  { path: '/invite/:token', element: <InvitePage /> },
  // /p/:slug — публичная доска проекта (Publish to web). Anon-доступ, вне AppShell/сайдбара.
  { path: '/p/:slug', element: <PublicBoardPage /> },
  // /p/:slug/t/:taskId — гейт отдельной страницы задачи (регистрация / редирект участника / отказ).
  { path: '/p/:slug/t/:taskId', element: <PublicTaskGatePage /> },
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
      // Уведомления переехали в чат-ленту; старые ссылки редиректим на главную.
      { path: 'notifications', element: <Navigate to="/" replace /> },
      { path: 'monitoring', element: <MonitoringOverviewPage /> },
      { path: 'monitoring/alerts', element: <AlertCenterPage /> },
      // Доска задач — «дом» проекта: при входе сразу показываем kanban.
      { path: 'projects/:projectId', element: <TasksPage /> },
      // Обзор/настройки проекта (git, KB, команда) переехали на отдельный роут.
      { path: 'projects/:projectId/overview', element: <ProjectPage /> },
      { path: 'projects/:projectId/kb', element: <KbPage /> },
      { path: 'projects/:projectId/monitoring', element: <MonitoringPage /> },
      { path: 'projects/:projectId/finance', element: <FinancePage /> },
      // Обратная совместимость со старыми ссылками на доску (напр. из уведомлений).
      { path: 'projects/:projectId/tasks', element: <LegacyTasksRedirect /> },
      // Отдельная страница задачи (кнопка «развернуть на весь экран» в дровере).
      { path: 'projects/:projectId/tasks/:taskId', element: <TaskDetailPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'workspaces/:workspaceId/settings', element: <WorkspaceSettingsPage /> },
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
