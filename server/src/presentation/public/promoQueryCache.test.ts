import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import { DEFAULT_PUBLIC_APPEARANCE, type Project } from '../../domain/project/Project.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import { GetPublicBoard } from '../../application/project/GetPublicBoard.js';
import { GetPublicTaskDetail } from '../../application/project/GetPublicTaskDetail.js';
import { renderPublicBoardMarkdown } from '../../application/project/PublicBoardSnapshotCache.js';
import { FilePublicBoardSnapshotCache } from '../../infrastructure/promo-cache/FilePublicBoardSnapshotCache.js';
import { sessionFromCookie } from '../middleware/sessionFromCookie.js';
import { publicBoardRouter } from './routes.js';
import {
  buildMergedSitemapXml,
  prefersMarkdown,
  resolveLandingMarkdownFile,
  sendLandingHtmlWithAuth,
  sendMarkdownFile,
  shouldSkipSessionLookup,
} from './promoDelivery.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p-pub-1',
    ownerId: 'u1',
    name: 'Публичный роадмап AI',
    icon: '🚀',
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    kbKind: 'none',
    financeVisibility: 'owner',
    dispatcherUserId: null,
    multiTaskWorker: false,
    isInbox: false,
    description: 'План развития платформы и база публичных задач',
    coverUrl: 'gradient:sky',
    coverPosition: 50,
    publicSlug: 'ai-roadmap-pub1',
    isPublic: true,
    publicIndexing: true,
    publicAppearance: DEFAULT_PUBLIC_APPEARANCE,
    appRepoFullName: null,
    siteSlug: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't-pub-1',
    projectId: 'p-pub-1',
    createdBy: 'u1',
    assignee: { userId: 'u1', displayName: 'Автор', avatarUrl: null },
    description: 'Сделать дисковый JSON-кэш\nБез единого SELECT к БД',
    icon: '⚡',
    cover: null,
    coverPosition: 50,
    status: 'in_progress',
    statusBeforeDone: null,
    position: 1,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: '2026-12-01',
    priority: 1,
    createdAt: new Date('2026-07-02T00:00:00Z'),
    updatedAt: new Date('2026-07-02T00:00:00Z'),
    ...over,
  };
}

function makeComment(over: Partial<TaskComment> = {}): TaskComment {
  return {
    id: 'c-pub-1',
    taskId: 't-pub-1',
    ownerUserId: 'u1',
    body: 'Готово для ИИ и поисковиков',
    actorKind: 'user',
    agentName: null,
    notifyMode: 'all',
    replyToCommentId: null,
    quotedText: null,
    createdAt: new Date('2026-07-03T10:00:00Z'),
    updatedAt: new Date('2026-07-03T10:00:00Z'),
    ...over,
  };
}

test('promo-query-cache (ProjectsFlow): 0 SQL на прогретых промо-маршрутах, публичных досках и .md двойниках даже с pf_session cookie', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-promo-cache-'));
  const cacheDir = path.join(tmpRoot, 'promo-cache');
  const landingDist = path.join(tmpRoot, 'landing-dist');
  fs.mkdirSync(path.join(landingDist, 'blog', 'kakuyu-llm-vybrat'), { recursive: true });
  fs.writeFileSync(
    path.join(landingDist, 'index.html'),
    '<!doctype html><html lang="ru" class="dark"><head><link rel="alternate" type="text/markdown" href="https://projectsflow.ru/index.md" /></head><body><main id="main"><h1>ProjectsFlow</h1></main></body></html>',
  );
  fs.writeFileSync(
    path.join(landingDist, 'blog', 'kakuyu-llm-vybrat', 'index.html'),
    '<!doctype html><html lang="ru" class="dark"><head><link rel="alternate" type="text/markdown" href="https://projectsflow.ru/blog/kakuyu-llm-vybrat.md" /></head><body><main id="main"><article><time datetime="2026-07-10">10 июля 2026</time></article></main></body></html>',
  );
  fs.writeFileSync(path.join(landingDist, 'index.md'), '# ProjectsFlow\n\nТарифы и возможности.\n');
  fs.writeFileSync(path.join(landingDist, 'blog.md'), '# Журнал ProjectsFlow\n');
  fs.writeFileSync(
    path.join(landingDist, 'blog', 'kakuyu-llm-vybrat.md'),
    '# Какую LLM выбрать\n\nРазбор моделей.\n',
  );
  fs.writeFileSync(
    path.join(landingDist, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://projectsflow.ru/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n',
  );

  let sqlCalls = 0;
  let poisoned = false;
  const guardSql = () => {
    sqlCalls++;
    if (poisoned) throw new Error('UNEXPECTED SQL QUERY ON WARM PROMO ROUTE');
  };

  let projectState: Project | null = makeProject();
  const projectsRepo = {
    async listPublished() {
      guardSql();
      return projectState && projectState.isPublic ? [projectState] : [];
    },
    async getById(id: string) {
      guardSql();
      return projectState && projectState.id === id ? projectState : null;
    },
    async getBySlug(slug: string) {
      guardSql();
      return projectState && projectState.publicSlug === slug ? projectState : null;
    },
  } as any;

  const tasksRepo = {
    async listByProject() {
      guardSql();
      return [makeTask()];
    },
    async getById(id: string) {
      guardSql();
      return id === 't-pub-1' ? makeTask() : null;
    },
  } as any;

  const commentsRepo = {
    async listByTask() {
      guardSql();
      return [makeComment(), makeComment({ id: 'c-agent', actorKind: 'agent', agentName: 'ralph' })];
    },
  } as any;

  const usersRepo = {
    async getById() {
      guardSql();
      return { id: 'u1', displayName: 'Ярослав', avatarUrl: null };
    },
  } as any;

  const getCurrentUserPoisoned = {
    async execute() {
      guardSql();
      throw new Error('SESSION DB SELECT SHOULD BE SKIPPED ON PROMO ROUTES');
    },
  } as any;

  try {
    const cache = new FilePublicBoardSnapshotCache({
      projects: projectsRepo,
      tasks: tasksRepo,
      comments: commentsRepo,
      users: usersRepo,
      cacheDir,
    });

    const summary = await cache.refreshAll();
    assert.equal(summary.indexExists, true);
    assert.equal(summary.publishedBoardsCount, 1);
    assert.equal(summary.indexedBoardsCount, 1);

    const files = fs.readdirSync(cacheDir).sort();
    assert.deepEqual(files, ['public-board-ai-roadmap-pub1.json', 'public-boards-index.json']);

    // С этого момента любые обращения к репозиториям и сессиям запрещены (0 SELECT).
    poisoned = true;
    sqlCalls = 0;

    const app = express();
    app.use(cookieParser());
    app.use(sessionFromCookie(getCurrentUserPoisoned));
    app.use(
      '/api/public/boards',
      publicBoardRouter({
        getPublicBoard: new GetPublicBoard({ projects: projectsRepo, tasks: tasksRepo }),
        getPublicTaskDetail: new GetPublicTaskDetail({
          projects: projectsRepo,
          tasks: tasksRepo,
          comments: commentsRepo,
          users: usersRepo,
        }),
        getPublicTaskAccess: { async execute() { return { projectId: 'p-pub-1', isMember: true }; } } as any,
        getPublicAttachment: { async execute() { return null; } } as any,
        clonePublicBoard: { async execute() { throw new Error('unused'); } } as any,
        projects: projectsRepo,
        coverStorage: { async read() { return null; } } as any,
        snapshotCache: cache,
      }),
    );

    app.get('/sitemap.xml', async (_req, res) => {
      const indexed = await cache.listIndexedBoards();
      const xml = await buildMergedSitemapXml(landingDist, indexed, 'https://projectsflow.ru');
      res.type('application/xml').send(xml);
    });
    app.get('/p/:slug.md', async (req, res) => {
      const board = await cache.getBoard(req.params.slug);
      if (!board) {
        res.status(404).send('# Not Found\n');
        return;
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.send(renderPublicBoardMarkdown(board, 'https://projectsflow.ru'));
    });
    app.get('*.md', async (req, res) => {
      const f = resolveLandingMarkdownFile(landingDist, req.path);
      if (!f) {
        res.status(404).send('# Not Found\n');
        return;
      }
      await sendMarkdownFile(res, f, { explicitMdTwin: true });
    });
    app.get('/landing', async (req, res) => {
      if (prefersMarkdown(req.headers.accept)) {
        const f = resolveLandingMarkdownFile(landingDist, '/landing');
        if (f) {
          await sendMarkdownFile(res, f);
          return;
        }
      }
      await sendLandingHtmlWithAuth(res, path.join(landingDist, 'index.html'), Boolean(req.cookies?.pf_session));
    });
    app.get('/blog/:slug/', async (req, res) => {
      if (prefersMarkdown(req.headers.accept)) {
        const f = resolveLandingMarkdownFile(landingDist, req.path);
        if (f) {
          await sendMarkdownFile(res, f);
          return;
        }
      }
      await sendLandingHtmlWithAuth(
        res,
        path.join(landingDist, 'blog', req.params.slug, 'index.html'),
        Boolean(req.cookies?.pf_session),
      );
    });

    const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer) => {
      const s = app.listen(0, () => resolveServer(s));
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const cookieHeader = { Cookie: 'pf_session=active-session-token-123' };

      // 1. /landing с cookie сессии → data-auth="authed" прямо в HTML, Vary: Accept, Cookie, 0 SQL
      const landingRes = await fetch(`${baseUrl}/landing`, { headers: cookieHeader });
      assert.equal(landingRes.status, 200);
      assert.match(landingRes.headers.get('vary') ?? '', /Accept/);
      const landingHtml = await landingRes.text();
      assert.match(landingHtml, /<html data-auth="authed"/);
      assert.match(landingHtml, /<main id="main">/);

      // 2. Accept: text/markdown на /blog/kakuyu-llm-vybrat/ → чистый Markdown, 0 SQL
      const blogMdNeg = await fetch(`${baseUrl}/blog/kakuyu-llm-vybrat/`, {
        headers: { ...cookieHeader, Accept: 'text/markdown, text/html;q=0.5' },
      });
      assert.equal(blogMdNeg.status, 200);
      assert.match(blogMdNeg.headers.get('content-type') ?? '', /^text\/markdown/);
      assert.match(await blogMdNeg.text(), /# Какую LLM выбрать/);

      // 3. Явный .md-двойник /index.md → X-Robots-Tag: noindex, follow
      const indexMd = await fetch(`${baseUrl}/index.md`, { headers: cookieHeader });
      assert.equal(indexMd.status, 200);
      assert.equal(indexMd.headers.get('x-robots-tag'), 'noindex, follow');

      // 4. Публичная доска и задача из JSON-снимка + 404 на неизвестный slug → 0 SQL
      const boardRes = await fetch(`${baseUrl}/api/public/boards/ai-roadmap-pub1`, { headers: cookieHeader });
      assert.equal(boardRes.status, 200);
      const boardJson = (await boardRes.json()) as any;
      assert.equal(boardJson.board.name, 'Публичный роадмап AI');

      const taskRes = await fetch(`${baseUrl}/api/public/boards/ai-roadmap-pub1/tasks/t-pub-1`, { headers: cookieHeader });
      assert.equal(taskRes.status, 200);
      const taskJson = (await taskRes.json()) as any;
      assert.equal(taskJson.task.comments.length, 1);
      assert.equal(taskJson.task.comments[0].authorDisplayName, 'Ярослав');

      const missingBoard = await fetch(`${baseUrl}/api/public/boards/unknown-404-slug`, { headers: cookieHeader });
      assert.equal(missingBoard.status, 404);

      // 5. Markdown публичной доски /p/:slug.md и объединённый /sitemap.xml → 0 SQL
      const boardMd = await fetch(`${baseUrl}/p/ai-roadmap-pub1.md`, { headers: cookieHeader });
      assert.equal(boardMd.status, 200);
      assert.match(await boardMd.text(), /Сделать дисковый JSON-кэш/);

      const sitemap = await fetch(`${baseUrl}/sitemap.xml`, { headers: cookieHeader });
      assert.equal(sitemap.status, 200);
      assert.match(await sitemap.text(), /https:\/\/projectsflow\.ru\/p\/ai-roadmap-pub1/);

      assert.equal(sqlCalls, 0);

      // 6. Снятие с публикации: атомарная перезапись без удаления файлов, затем снова 0 SQL и 404
      poisoned = false;
      projectState = makeProject({ isPublic: false });
      await cache.refreshProject('p-pub-1');
      poisoned = true;
      sqlCalls = 0;

      const unpublishedRes = await fetch(`${baseUrl}/api/public/boards/ai-roadmap-pub1`, { headers: cookieHeader });
      assert.equal(unpublishedRes.status, 404);
      assert.equal(sqlCalls, 0);
      assert.equal(fs.existsSync(path.join(cacheDir, 'public-board-ai-roadmap-pub1.json')), true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  assert.equal(shouldSkipSessionLookup({ method: 'GET', path: '/blog/' }), true);
  assert.equal(shouldSkipSessionLookup({ method: 'GET', path: '/api/public/boards/abc' }), true);
  assert.equal(shouldSkipSessionLookup({ method: 'GET', path: '/api/public/boards/abc/tasks/t1/access' }), false);
  assert.equal(shouldSkipSessionLookup({ method: 'POST', path: '/api/public/boards/abc/clone' }), false);
  assert.equal(shouldSkipSessionLookup({ method: 'GET', path: '/api/auth/me' }), false);
});
