import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Request, Response } from 'express';
import type { PublicBoardsIndexEntry } from '../../application/project/PublicBoardSnapshotCache.js';

/**
 * Разбор заголовка Accept (RFC 9110): true только тогда, когда клиент явно
 * запросил `text/markdown` / `text/x-markdown` с весом q > 0 и не ниже `text/html`.
 */
export function prefersMarkdown(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) return false;
  let mdQ = -1;
  let htmlQ = -1;

  for (const rawPart of acceptHeader.split(',')) {
    const segments = rawPart.trim().split(';');
    const mime = (segments[0] ?? '').trim().toLowerCase();
    if (!mime) continue;
    let q = 1;
    for (let i = 1; i < segments.length; i++) {
      const kv = (segments[i] ?? '').trim().split('=');
      if (kv[0]?.trim().toLowerCase() === 'q') {
        const parsed = Number.parseFloat(kv[1]?.trim() ?? '1');
        if (Number.isFinite(parsed)) q = Math.max(0, Math.min(1, parsed));
      }
    }
    if (mime === 'text/markdown' || mime === 'text/x-markdown') {
      mdQ = Math.max(mdQ, q);
    } else if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      htmlQ = Math.max(htmlQ, q);
    }
  }

  return mdQ > 0 && mdQ >= htmlQ;
}

/**
 * Пропускает обращение к БД в `sessionFromCookie` на всех не-`/api` путях
 * (лендинг, блог, статика, *.md, /llms*.txt, /sitemap.xml, SPA-оболочка)
 * и на публичных read-only эндпоинтах досок, где `req.user` не используется.
 *
 * Исключение внутри `/api/public/boards`: `/:slug/tasks/:taskId/access` и
 * `POST /:slug/clone` используют `req.user` — для них сессия резолвится штатно.
 */
export function shouldSkipSessionLookup(req: Pick<Request, 'method' | 'path'>): boolean {
  const p = req.path || '/';
  if (!p.startsWith('/api/') && p !== '/api') return true;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (p === '/api/health') return true;
  if (p.startsWith('/api/public/boards/')) {
    if (/\/tasks\/[^/]+\/access\/?$/.test(p)) return false;
    return true;
  }
  return false;
}

/**
 * Сопоставляет публичный путь (или `.md`-двойник) с собранным Markdown-файлом в `landingDist`.
 */
export function resolveLandingMarkdownFile(landingDist: string, rawPath: string): string | null {
  const clean = (rawPath || '/').replace(/\/+$/, '') || '/';
  let rel: string | null = null;
  if (clean === '/' || clean === '/landing' || clean === '/index.md' || clean === '/landing.md') {
    rel = 'index.md';
  } else if (clean === '/blog' || clean === '/blog.md') {
    rel = 'blog.md';
  } else {
    const m = clean.match(/^\/blog\/([a-z0-9-]+?)(?:\.md)?$/i);
    if (m && m[1]) rel = `blog/${m[1]}.md`;
  }
  if (!rel) return null;
  const abs = resolve(landingDist, rel);
  if (!abs.startsWith(landingDist + sep)) return null;
  return existsSync(abs) ? abs : null;
}

export async function sendMarkdownFile(
  res: Response,
  filePath: string,
  opts?: { explicitMdTwin?: boolean },
): Promise<void> {
  const content = await readFile(filePath, 'utf8');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Vary', 'Accept');
  res.setHeader('Cache-Control', opts?.explicitMdTwin ? 'public, max-age=300' : 'no-cache');
  if (opts?.explicitMdTwin) {
    res.setHeader('X-Robots-Tag', 'noindex, follow');
  }
  res.status(200).send(content);
}

/**
 * Отдаёт собранную Astro-страницу с `Vary: Accept, Cookie` и при наличии
 * сессионной cookie подставляет `data-auth="authed"` прямо в тег `<html>` (0 SQL, 0 мигания CTA).
 */
export async function sendLandingHtmlWithAuth(
  res: Response,
  filePath: string,
  isAuthed: boolean,
): Promise<void> {
  let html = await readFile(filePath, 'utf8');
  if (isAuthed) {
    html = html.replace(/<html\b(?![^>]*\bdata-auth=)/i, '<html data-auth="authed"');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Vary', 'Accept, Cookie');
  res.status(200).send(html);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function buildMergedSitemapXml(
  landingDist: string,
  indexedBoards: readonly PublicBoardsIndexEntry[],
  siteOrigin = 'https://projectsflow.ru',
): Promise<string | null> {
  const staticSitemapPath = resolve(landingDist, 'sitemap.xml');
  const base = siteOrigin.replace(/\/+$/, '');
  const extraEntries = indexedBoards
    .map((b) => {
      const lastmod = b.updatedAt.slice(0, 10);
      return `  <url><loc>${escapeXml(`${base}/p/${b.slug}`)}</loc><lastmod>${escapeXml(lastmod)}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`;
    })
    .join('\n');

  if (existsSync(staticSitemapPath)) {
    const raw = await readFile(staticSitemapPath, 'utf8');
    if (!extraEntries) return raw;
    return raw.replace('</urlset>', `${extraEntries}\n</urlset>`);
  }

  if (!extraEntries) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${extraEntries}\n</urlset>\n`;
}
