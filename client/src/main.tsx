import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/styles/globals.css';

import { ContainerProvider } from '@/infrastructure/di/container';
import { ThemeProvider } from '@/presentation/components/theme/ThemeProvider';
import { AuthProvider } from '@/presentation/auth/AuthProvider';
import { Toaster } from '@/components/ui/sonner';
import { router } from '@/presentation/app/routes';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ContainerProvider>
      <ThemeProvider defaultTheme="system" storageKey="pf-theme">
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </ContainerProvider>
  </React.StrictMode>,
);
