import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
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
    hmr: {
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
