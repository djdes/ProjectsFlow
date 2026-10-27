import { createServer, defineConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

export default defineConfig({
  // Маркер сборки: git sha из CI (GITHUB_SHA) — виден в консоли и в «⋯»-меню
  // проекта. Позволяет мгновенно понять, какую версию видит пользователь.
  define: {
    __PF_BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)),
  },
  plugins: [react(), {
    name: 'release-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ revision: process.env.GITHUB_SHA ?? null }) });
    },
  }, {
    name: 'inline-boot-recovery',
    transformIndexHtml() {
      return [
        { tag: 'script', children: readFileSync(new URL('./src/boot/recovery.js', import.meta.url), 'utf8'), injectTo: 'head-prepend' as const },
        { tag: 'style', children: readFileSync(new URL('./src/boot/recovery.css', import.meta.url), 'utf8'), injectTo: 'head-prepend' as const },
      ];
    },
  }, {
    // The first HTML paint shows the same skeleton React renders while the app loads
    // (presentation/components/loading/bootSkeleton.tsx), instead of a hand-made copy.
    name: 'prerender-boot-skeleton',
    async transformIndexHtml(html, ctx) {
      const server: ViteDevServer = ctx.server ?? await createServer({
        configFile: false,
        root: __dirname,
        logLevel: 'error',
        appType: 'custom',
        server: { middlewareMode: true, hmr: false, ws: false },
        resolve: { alias: { '@': path.resolve(__dirname, './src') } },
      });
      try {
        const mod = await server.ssrLoadModule('/src/presentation/components/loading/bootSkeleton.tsx');
        return html.replace('<!--pf-boot-skeleton-->', (mod.renderBootSkeleton as () => string)());
      } finally {
        if (!ctx.server) await server.close();
      }
    },
  }],
  resolve: {
    // Dialog and Popover must share the layer/focus stacks even when their Radix
    // dependencies resolve to different patch versions. Otherwise Escape in a
    // nested picker closes its parent task drawer as well.
    dedupe: ['@radix-ui/react-dismissable-layer', '@radix-ui/react-focus-scope'],
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
