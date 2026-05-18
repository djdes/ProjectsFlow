import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/presentation/layout/AppShell';
import { HomePage } from '@/presentation/pages/HomePage';
import { ProjectPage } from '@/presentation/pages/ProjectPage';
import { KbPage } from '@/presentation/pages/KbPage';
import { TasksPage } from '@/presentation/pages/TasksPage';
import { ProfilePage } from '@/presentation/pages/ProfilePage';
import { NotFoundPage } from '@/presentation/pages/NotFoundPage';
import { LoginPage } from '@/presentation/pages/LoginPage';
import { RegisterPage } from '@/presentation/pages/RegisterPage';
import { DevicePage } from '@/presentation/pages/DevicePage';
import { ProtectedRoute } from '@/presentation/auth/ProtectedRoute';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
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
      { index: true, element: <HomePage /> },
      { path: 'projects/:projectId', element: <ProjectPage /> },
      { path: 'projects/:projectId/kb', element: <KbPage /> },
      { path: 'projects/:projectId/tasks', element: <TasksPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
