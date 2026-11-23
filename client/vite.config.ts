import { createServer, defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Service worker (public/sw.js, registered by src/main.tsx). After the bundle is written, the
// build id and the file lists are injected into dist/sw.js: every deploy ships a new sw.js, the
// browser installs it and it deletes the previous build's caches. The id hashes index.html and
// the file names, so an unchanged rebuild does not make devices update. app-shell.html is a copy
// of index.html that the service worker caches on install (on prod /index.html is the landing).
function pwaServiceWorker(): Plugin {
  return {
    name: 'pwa-service-worker',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/'))
        .map((file) => `/${file}`)
        .sort();
      const entry = [...new Set([...html.matchAll(/\b(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
      const build = createHash('sha256').update(html).update(assets.join('\n')).digest('hex').slice(0, 12);
      const swPath = path.join(outDir, 'sw.js');
      let sw = readFileSync(swPath, 'utf8');
      const inject = (pattern: RegExp, line: string): void => {
        if (!pattern.test(sw)) throw new Error(`pwa-service-worker: ${pattern} not found in public/sw.js`);
        sw = sw.replace(pattern, () => line);
      };
      inject(/^const BUILD = .*;$/m, `const BUILD = ${JSON.stringify(build)};`);
      inject(/^const PRECACHE = .*;$/m, `const PRECACHE = ${JSON.stringify(entry)};`);
      inject(/^const ASSETS = .*;$/m, `const ASSETS = ${JSON.stringify(assets)};`);
      writeFileSync(swPath, sw);
      writeFileSync(path.join(outDir, 'app-shell.html'), html);
    },
  };
}

export default defineConfig({
  // Маркер сборки: git sha из CI (GITHUB_SHA) — виден в консоли и в «⋯»-меню
  // проекта. Позволяет мгновенно понять, какую версию видит пользователь.
  define: {
    __PF_BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)),
  },
  plugins: [react(), pwaServiceWorker(), {
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
  build: {
    rolldownOptions: {
      output: {
        // Startup used to fetch ~110 files, most under 1 KB (one per icon, small hooks and
        // labels). Merged here: every icon (one file, ~26 KB gz), everything the entry imports
        // statically, and small modules shared by three or more screens. Screens themselves stay
        // separate lazy chunks. Measured: startup 108 → 20 files, 839 → 810 KB gz.
        codeSplitting: {
          groups: [
            { name: 'icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, priority: 30 },
            { name: 'initial', tags: ['$initial'], priority: 20 },
            { name: 'shared', test: /[\\/]src[\\/]/, minShareCount: 3, maxModuleSize: 4_000, priority: 10 },
          ],
        },
      },
    },
  },
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
