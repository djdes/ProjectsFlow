import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AppShell } from '@/presentation/layout/AppShell';
import { NotFoundPage } from '@/presentation/pages/NotFoundPage';
import { boardSlugFromHost } from '@/lib/publicBoardUrl';
import { ProtectedRoute } from '@/presentation/auth/ProtectedRoute';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';

// Code-splitting (A4): каждая страница уезжает в свой chunk и грузится по требованию.
// Раньше весь SPA (dnd-kit, motion, admin, monitoring, finance, tiptap) шёл одним
// бандлом ~1.9 MB — в т.ч. анониму на публичной доске. `page()` разворачивает named-export
// в default для React.lazy; `el()` оборачивает элемент в Suspense с общим фолбэком.
function page<M extends Record<string, unknown>>(
  loader: () => Promise<M>,
  key: keyof M,
): ComponentType {
  return lazy(() => loader().then((m) => ({ default: m[key] as ComponentType })));
}

function RouteFallback(): ReactElement {
  return <div className="grid h-dvh place-items-center bg-background" />;
}

function el(node: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

const ProjectPage = page(() => import('@/presentation/pages/ProjectPage'), 'ProjectPage');
const KbPage = page(() => import('@/presentation/pages/KbPage'), 'KbPage');
const MonitoringPage = page(() => import('@/presentation/pages/MonitoringPage'), 'MonitoringPage');
const MonitoringOverviewPage = page(
  () => import('@/presentation/pages/MonitoringOverviewPage'),
  'MonitoringOverviewPage',
);
const AlertCenterPage = page(() => import('@/presentation/pages/AlertCenterPage'), 'AlertCenterPage');
const TasksPage = page(() => import('@/presentation/pages/TasksPage'), 'TasksPage');
const TaskDetailPage = page(() => import('@/presentation/pages/TaskDetailPage'), 'TaskDetailPage');
const InboxPage = page(() => import('@/presentation/pages/InboxPage'), 'InboxPage');
const ProfilePage = page(() => import('@/presentation/pages/ProfilePage'), 'ProfilePage');
const WorkspaceSettingsPage = page(
  () => import('@/presentation/pages/WorkspaceSettingsPage'),
  'WorkspaceSettingsPage',
);
const FinancePage = page(() => import('@/presentation/pages/FinancePage'), 'FinancePage');
const AdminPage = page(() => import('@/presentation/pages/AdminPage'), 'AdminPage');
const LoginPage = page(() => import('@/presentation/pages/LoginPage'), 'LoginPage');
const RegisterPage = page(() => import('@/presentation/pages/RegisterPage'), 'RegisterPage');
const DevicePage = page(() => import('@/presentation/pages/DevicePage'), 'DevicePage');
const InvitePage = page(() => import('@/presentation/pages/InvitePage'), 'InvitePage');
const PublicBoardPage = page(() => import('@/presentation/pages/PublicBoardPage'), 'PublicBoardPage');
const PublicTaskGatePage = page(
  () => import('@/presentation/pages/PublicTaskGatePage'),
  'PublicTaskGatePage',
);
const DuplicatePage = page(() => import('@/presentation/pages/DuplicatePage'), 'DuplicatePage');

// Доска переехала с /projects/:id/tasks на /projects/:id. Старые ссылки
// (например, из уведомлений) редиректим на новый «дом» проекта.
function LegacyTasksRedirect(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId}`} replace />;
}

// Гард admin-раздела: не-админа уводим на главную. Сервер всё равно отдаёт 403.
function AdminOnly({ children }: { children: ReactElement }): ReactElement {
  const { user, loading } = useCurrentUser();
  if (loading) return <RouteFallback />;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return children;
}

// Notion-style поддомен доски: <slug>.projectsflow.ru. Если открыты на нём — ВЕСЬ SPA это
// публичная доска (slug берётся из hostname, не из пути). Иначе — обычное приложение.
const boardHostSlug = boardSlugFromHost();

export const router = createBrowserRouter(
  boardHostSlug
    ? [
        { path: '/', element: el(<PublicBoardPage />) },
        { path: '/t/:taskId', element: el(<PublicTaskGatePage />) },
        { path: '*', element: el(<PublicBoardPage />) },
      ]
    : [
  { path: '/login', element: el(<LoginPage />) },
  { path: '/register', element: el(<RegisterPage />) },
  // /duplicate?slug=… — «Дублировать» с публичной доски: после логина клонирует доску в аккаунт.
  { path: '/duplicate', element: el(<DuplicatePage />) },
  // /invite/:token — anon-доступная страница. Внутри сам решает, что показать
  // (preview + accept или редирект на /login через state.from).
  { path: '/invite/:token', element: el(<InvitePage />) },
  // /p/:slug — публичная доска проекта (Publish to web). Anon-доступ, вне AppShell/сайдбара.
  { path: '/p/:slug', element: el(<PublicBoardPage />) },
  // /p/:slug/t/:taskId — гейт отдельной страницы задачи (регистрация / редирект участника / отказ).
  { path: '/p/:slug/t/:taskId', element: el(<PublicTaskGatePage />) },
  {
    path: '/device',
    element: (
      <ProtectedRoute>
        {el(<DevicePage />)}
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
      { index: true, element: el(<InboxPage />) },
      // Старые ссылки на /inbox редиректим на канонический «/».
      { path: 'inbox', element: <Navigate to="/" replace /> },
      // Уведомления переехали в чат-ленту; старые ссылки редиректим на главную.
      { path: 'notifications', element: <Navigate to="/" replace /> },
      { path: 'monitoring', element: el(<MonitoringOverviewPage />) },
      { path: 'monitoring/alerts', element: el(<AlertCenterPage />) },
      // Доска задач — «дом» проекта: при входе сразу показываем kanban.
      { path: 'projects/:projectId', element: el(<TasksPage />) },
      // Обзор/настройки проекта (git, KB, команда) переехали на отдельный роут.
      { path: 'projects/:projectId/overview', element: el(<ProjectPage />) },
      { path: 'projects/:projectId/kb', element: el(<KbPage />) },
      { path: 'projects/:projectId/monitoring', element: el(<MonitoringPage />) },
      { path: 'projects/:projectId/finance', element: el(<FinancePage />) },
      // Обратная совместимость со старыми ссылками на доску (напр. из уведомлений).
      { path: 'projects/:projectId/tasks', element: <LegacyTasksRedirect /> },
      // Отдельная страница задачи (кнопка «развернуть на весь экран» в дровере).
      { path: 'projects/:projectId/tasks/:taskId', element: el(<TaskDetailPage />) },
      { path: 'profile', element: el(<ProfilePage />) },
      { path: 'workspaces/:workspaceId/settings', element: el(<WorkspaceSettingsPage />) },
      {
        path: 'admin',
        element: (
          <AdminOnly>
            {el(<AdminPage />)}
          </AdminOnly>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
