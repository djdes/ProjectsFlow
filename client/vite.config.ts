import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Маркер сборки: git sha из CI (GITHUB_SHA) — виден в консоли и в «⋯»-меню
  // проекта. Позволяет мгновенно понять, какую версию видит пользователь.
  define: {
    __PF_BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // Playwright подключается к уже открытому Chrome и иногда проверяет локальную
    // сборку по LAN-IP. В таком режиме production-WSS HMR бесконечно переподключается
    // к :443 и забивает страницу ошибками. Для детерминированного visual-run HMR
    // можно отключить, не меняя обычный dev-режим.
    hmr:
      process.env.PF_DISABLE_HMR === '1'
        ? false
        : {
            clientPort: 443,
            protocol: 'wss',
          },
    proxy: {
      // Все запросы /api/* dev-сервер проксирует в Express на 4317.
      // Cookie пересылаются прозрачно: для браузера всё выглядит same-origin.
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
      },
    },
  },
});
