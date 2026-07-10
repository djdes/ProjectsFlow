import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import '@/styles/globals.css';

import { ContainerProvider } from '@/infrastructure/di/container';
import { ThemeProvider } from '@/presentation/components/theme/ThemeProvider';
import { MotionProvider } from '@/presentation/components/motion/MotionProvider';
import { AuthProvider } from '@/presentation/auth/AuthProvider';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/presentation/components/ErrorBoundary';
import { router } from '@/presentation/app/routes';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ContainerProvider>
        <ThemeProvider defaultTheme="system" storageKey="pf-theme">
          <MotionProvider storageKey="pf-motion">
            <AuthProvider>
              <RouterProvider router={router} />
              <Toaster />
            </AuthProvider>
          </MotionProvider>
        </ThemeProvider>
      </ContainerProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
