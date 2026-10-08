import express, { type Express } from 'express';
import { basename } from 'node:path';

/** Asset misses must not fall through to the SPA's HTML response. */
export function mountBuildAssets(app: Express, prefix: string, directory: string): void {
  app.use(prefix, express.static(directory, {
    index: false,
    redirect: false,
    setHeaders(res, file) {
      const hashed = /[.-][\w-]{8,}\.[a-z0-9]+$/i.test(basename(file));
      res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text/plain').send('Файл не найден');
  });
}
