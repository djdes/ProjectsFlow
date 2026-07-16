import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import '@/styles/globals.css';

import { ContainerProvider } from '@/infrastructure/di/container';
import { ThemeProvider } from '@/presentation/components/theme/ThemeProvider';
import { MotionProvider } from '@/presentation/components/motion/MotionProvider';
import { AuthProvider } from '@/presentation/auth/AuthProvider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/presentation/components/ErrorBoundary';
import { router } from '@/presentation/app/routes';

// Маркер версии в консоль: `ProjectsFlow build <sha>` — быстрый способ проверить,
// какую сборку реально выполняет вкладка (диагностика «у меня старое поведение»).
console.info(`ProjectsFlow build ${__PF_BUILD__}`);

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ContainerProvider>
        <ThemeProvider defaultTheme="system" storageKey="pf-theme">
          <MotionProvider storageKey="pf-motion">
            <AuthProvider>
              {/* Глобальный TooltipProvider: Radix-Tooltip требует провайдер-предка. Раньше он
                  был раскидан по компонентам (AppShell/Sidebar/страницы), и любой <Tooltip> вне
                  них падал «Tooltip must be used within TooltipProvider» (напр. в lazy-чанках/
                  диалогах). Один провайдер на корень покрывает всё; локальные вложенные — их
                  настройки перекрывают этот дефолт для своих поддеревьев. */}
              <TooltipProvider delayDuration={550} skipDelayDuration={120}>
                <RouterProvider router={router} />
                <Toaster />
              </TooltipProvider>
            </AuthProvider>
          </MotionProvider>
        </ThemeProvider>
      </ContainerProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
