/**
 * Файловый JSON-кэш опубликованных публичных досок (Publish to web) и промо-индексов.
 *
 * Правила хранения (по скиллу promo-query-cache):
 *   • Именованные JSON-конверты version=1: `public-boards-index.json` и `public-board-<slug>.json`.
 *   • Хранение вне вычищаемых при деплое папок: PROMO_CACHE_DIR →
 *     /var/www/projectsflow/data/promo-cache → .cache/promo-cache (в .gitignore).
 *   • Атомарная запись через временный файл в той же папке + rename. Никаких rm/unlink при
 *     снятии с публикации (индекс перезаписывается без удалённого slug, снимок доски — с board:null).
 *   • 0 удержания в памяти процесса (никаких Map в RAM между запросами) и 0 TTL на чтении:
 *     все обновления идут при изменении проекта/задачи/комментария и на деплое.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../../domain/project/Project.js';
import type { PublicBoard, PublicComment, PublicTask, PublicTaskDetail } from '../../domain/project/PublicBoard.js';
import { TASK_STATUSES, type Task } from '../../domain/task/Task.js';
import { rewriteAttachmentUrls } from '../../domain/project/publicAttachments.js';
import { publicCoverUrl } from '../../application/project/GetPublicBoard.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import type { TaskCommentRepository } from '../../application/task/TaskCommentRepository.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type {
  PromoCacheStatusSummary,
  PublicBoardBundleSnapshot,
  PublicBoardSnapshotCache,
  PublicBoardsIndexEntry,
  PublicBoardsIndexSnapshot,
} from '../../application/project/PublicBoardSnapshotCache.js';

export interface PromoSnapshotEnvelope<T> {
  readonly version: 1;
  readonly dataset: string;
  readonly generatedAt: string;
  readonly data: T;
}

const PROD_DATA_PARENT = '/var/www/projectsflow/data';
const PROD_PROMO_CACHE_DIR = '/var/www/projectsflow/data/promo-cache';
const INDEX_DATASET = 'public-boards-index';

const COVER_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

export function resolvePromoCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['PROMO_CACHE_DIR']?.trim();
  if (explicit) return path.resolve(explicit);

  try {
    if (process.platform !== 'win32' && fs.existsSync(PROD_DATA_PARENT)) {
      fs.accessSync(PROD_DATA_PARENT, fs.constants.W_OK);
      return PROD_PROMO_CACHE_DIR;
    }
  } catch {
    // Нет доступа к /var/www/projectsflow/data — используем локальную папку .cache/promo-cache.
  }

  return path.resolve(process.cwd(), '.cache', 'promo-cache');
}

function sanitizeDataset(name: string): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safe) throw new Error('Empty promo dataset name');
  return safe;
}

function boardDatasetName(slug: string): string {
  return `public-board-${sanitizeDataset(slug)}`;
}

function datasetPath(cacheDir: string, dataset: string): string {
  return path.join(cacheDir, `${sanitizeDataset(dataset)}.json`);
}

async function readEnvelope<T>(cacheDir: string, dataset: string): Promise<PromoSnapshotEnvelope<T> | null> {
  try {
    const raw = await fsp.readFile(datasetPath(cacheDir, dataset), 'utf8');
    const parsed = JSON.parse(raw) as PromoSnapshotEnvelope<T>;
    if (parsed && parsed.version === 1 && 'data' in parsed) return parsed;
    return null;
  } catch {
    return null;
  }
}

function readEnvelopeSync<T>(cacheDir: string, dataset: string): PromoSnapshotEnvelope<T> | null {
  try {
    const raw = fs.readFileSync(datasetPath(cacheDir, dataset), 'utf8');
    const parsed = JSON.parse(raw) as PromoSnapshotEnvelope<T>;
    if (parsed && parsed.version === 1 && 'data' in parsed) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function writeEnvelopeAtomic<T>(
  cacheDir: string,
  dataset: string,
  data: T,
): Promise<PromoSnapshotEnvelope<T>> {
  await fsp.mkdir(cacheDir, { recursive: true });
  const target = datasetPath(cacheDir, dataset);
  const nonce = randomBytes(6).toString('hex');
  const tmp = `${target}.${process.pid}.${nonce}.tmp`;
  const envelope: PromoSnapshotEnvelope<T> = {
    version: 1,
    dataset,
    generatedAt: new Date().toISOString(),
    data,
  };
  try {
    await fsp.writeFile(tmp, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return envelope;
}

function toPublicTask(t: Task): PublicTask {
  return {
    id: t.id,
    description: t.description,
    icon: t.icon,
    cover: t.cover,
    coverPosition: t.coverPosition,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
  };
}

function extractCoverStorage(coverUrl: string | null): {
  storageKey: string | null;
  mimeType: string | null;
} {
  if (!coverUrl) return { storageKey: null, mimeType: null };
  const m = coverUrl.match(
    /^\/api\/projects\/([a-f0-9-]+)\/cover\/([a-f0-9-]+\.(?:jpg|png|webp|gif|avif))$/i,
  );
  if (!m) return { storageKey: null, mimeType: null };
  const [, projectId, file] = m;
  const ext = file!.split('.').pop()!.toLowerCase();
  return {
    storageKey: `covers/${projectId}/${file}`,
    mimeType: COVER_MIME[ext] ?? 'application/octet-stream',
  };
}

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly users: UserRepository;
  readonly cacheDir?: string;
};

export class FilePublicBoardSnapshotCache implements PublicBoardSnapshotCache {
  private readonly cacheDir: string;
  private inflightAll: Promise<PromoCacheStatusSummary> | null = null;
  private readonly pendingProjects = new Map<string, NodeJS.Timeout>();
  private readonly inflightProjects = new Map<string, Promise<void>>();

  constructor(private readonly deps: Deps) {
    this.cacheDir = deps.cacheDir ?? resolvePromoCacheDir();
  }

  private async ensureIndex(): Promise<PublicBoardsIndexSnapshot> {
    const existing = await readEnvelope<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET);
    if (existing) return existing.data;
    await this.refreshAll();
    const rebuilt = await readEnvelope<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET);
    return rebuilt?.data ?? { slugs: {}, projectSlugs: {} };
  }

  async getBoard(slug: string): Promise<PublicBoard | null> {
    const index = await this.ensureIndex();
    if (!index.slugs[slug]) return null;
    const snap = await readEnvelope<PublicBoardBundleSnapshot>(this.cacheDir, boardDatasetName(slug));
    if (snap) return snap.data.board;
    await this.refreshProject(index.slugs[slug]!.projectId);
    const rebuilt = await readEnvelope<PublicBoardBundleSnapshot>(this.cacheDir, boardDatasetName(slug));
    return rebuilt?.data.board ?? null;
  }

  async getTaskDetail(slug: string, taskId: string): Promise<PublicTaskDetail | null> {
    const index = await this.ensureIndex();
    if (!index.slugs[slug]) return null;
    const snap = await readEnvelope<PublicBoardBundleSnapshot>(this.cacheDir, boardDatasetName(slug));
    if (snap) return snap.data.tasks[taskId] ?? null;
    await this.refreshProject(index.slugs[slug]!.projectId);
    const rebuilt = await readEnvelope<PublicBoardBundleSnapshot>(this.cacheDir, boardDatasetName(slug));
    return rebuilt?.data.tasks[taskId] ?? null;
  }

  async getCoverMeta(slug: string): Promise<{ storageKey: string; mimeType: string } | null> {
    const index = await this.ensureIndex();
    const entry = index.slugs[slug];
    if (!entry || !entry.coverStorageKey || !entry.coverMimeType) return null;
    return { storageKey: entry.coverStorageKey, mimeType: entry.coverMimeType };
  }

  async listIndexedBoards(): Promise<readonly PublicBoardsIndexEntry[]> {
    const existing = await readEnvelope<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET);
    if (!existing) return [];
    return Object.values(existing.data.slugs).filter((e) => e.indexing);
  }

  private async buildBoardBundle(project: Project): Promise<{
    entry: PublicBoardsIndexEntry;
    bundle: PublicBoardBundleSnapshot;
  }> {
    const slug = project.publicSlug!;
    const tasks = await this.deps.tasks.listByProject(project.id);
    const columns = TASK_STATUSES.map((status) => ({
      status,
      tasks: tasks.filter((t) => t.status === status).map(toPublicTask),
    }));
    const board: PublicBoard = {
      slug,
      name: project.name,
      icon: project.icon,
      description: project.description,
      coverUrl: publicCoverUrl(slug, project.coverUrl),
      coverPosition: project.coverPosition,
      indexing: project.publicIndexing,
      appearance: project.publicAppearance,
      columns,
    };

    const authorCache = new Map<string, { displayName: string; avatarUrl: string | null }>();
    const details: Record<string, PublicTaskDetail> = {};
    for (const task of tasks) {
      const rawComments = await this.deps.comments.listByTask(task.id);
      const human = rawComments.filter((c) => c.actorKind === 'user');
      const comments: PublicComment[] = [];
      for (const c of human) {
        let author = authorCache.get(c.ownerUserId);
        if (!author) {
          const u = await this.deps.users.getById(c.ownerUserId);
          author = {
            displayName: u?.displayName ?? 'Участник',
            avatarUrl: u?.avatarUrl ?? null,
          };
          authorCache.set(c.ownerUserId, author);
        }
        comments.push({
          id: c.id,
          authorDisplayName: author.displayName,
          authorAvatarUrl: author.avatarUrl,
          body: rewriteAttachmentUrls(c.body, slug),
          createdAt: c.createdAt.toISOString(),
        });
      }
      details[task.id] = {
        id: task.id,
        description: task.description ? rewriteAttachmentUrls(task.description, slug) : null,
        icon: task.icon,
        cover: task.cover,
        coverPosition: task.coverPosition,
        status: task.status,
        priority: task.priority,
        deadline: task.deadline,
        comments,
      };
    }

    const cover = extractCoverStorage(project.coverUrl);
    const entry: PublicBoardsIndexEntry = {
      projectId: project.id,
      slug,
      name: project.name,
      description: project.description,
      indexing: project.publicIndexing,
      coverStorageKey: cover.storageKey,
      coverMimeType: cover.mimeType,
      updatedAt: new Date().toISOString(),
    };

    return { entry, bundle: { board, tasks: details } };
  }

  async refreshProject(projectId: string): Promise<void> {
    const running = this.inflightProjects.get(projectId);
    if (running) return running;

    const job = (async () => {
      const currentSnap = await readEnvelope<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET);
      const slugs: Record<string, PublicBoardsIndexEntry> = { ...(currentSnap?.data.slugs ?? {}) };
      const projectSlugs: Record<string, string> = { ...(currentSnap?.data.projectSlugs ?? {}) };

      const prevSlug = projectSlugs[projectId];
      const project = await this.deps.projects.getById(projectId);

      if (!project || !project.isPublic || !project.publicSlug) {
        if (!prevSlug && !currentSnap) return;
        if (prevSlug) {
          delete slugs[prevSlug];
          delete projectSlugs[projectId];
          // Атомарная перезапись без удаления файла (never delete-to-invalidate).
          await writeEnvelopeAtomic<PublicBoardBundleSnapshot>(
            this.cacheDir,
            boardDatasetName(prevSlug),
            { board: null, tasks: {} },
          );
        }
        await writeEnvelopeAtomic<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET, {
          slugs,
          projectSlugs,
        });
        return;
      }

      if (prevSlug && prevSlug !== project.publicSlug) {
        delete slugs[prevSlug];
        await writeEnvelopeAtomic<PublicBoardBundleSnapshot>(
          this.cacheDir,
          boardDatasetName(prevSlug),
          { board: null, tasks: {} },
        );
      }

      const { entry, bundle } = await this.buildBoardBundle(project);
      await writeEnvelopeAtomic(this.cacheDir, boardDatasetName(entry.slug), bundle);
      slugs[entry.slug] = entry;
      projectSlugs[project.id] = entry.slug;
      await writeEnvelopeAtomic<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET, {
        slugs,
        projectSlugs,
      });
    })();

    this.inflightProjects.set(projectId, job);
    try {
      await job;
    } finally {
      this.inflightProjects.delete(projectId);
    }
  }

  scheduleRefreshProject(projectId: string): void {
    const existing = this.pendingProjects.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingProjects.delete(projectId);
      void this.refreshProject(projectId).catch((err: unknown) => {
        console.warn('[promo-cache] refreshProject failed:', (err as Error)?.message ?? err);
      });
    }, 50);
    timer.unref?.();
    this.pendingProjects.set(projectId, timer);
  }

  async refreshAll(): Promise<PromoCacheStatusSummary> {
    if (this.inflightAll) return this.inflightAll;
    const job = (async () => {
      const published = this.deps.projects.listPublished
        ? await this.deps.projects.listPublished()
        : [];
      const slugs: Record<string, PublicBoardsIndexEntry> = {};
      const projectSlugs: Record<string, string> = {};

      for (const project of published) {
        if (!project.isPublic || !project.publicSlug) continue;
        const { entry, bundle } = await this.buildBoardBundle(project);
        await writeEnvelopeAtomic(this.cacheDir, boardDatasetName(entry.slug), bundle);
        slugs[entry.slug] = entry;
        projectSlugs[project.id] = entry.slug;
      }

      await writeEnvelopeAtomic<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET, {
        slugs,
        projectSlugs,
      });
      return this.status();
    })();

    this.inflightAll = job;
    try {
      return await job;
    } finally {
      this.inflightAll = null;
    }
  }

  status(): PromoCacheStatusSummary {
    const index = readEnvelopeSync<PublicBoardsIndexSnapshot>(this.cacheDir, INDEX_DATASET);
    const entries = index ? Object.values(index.data.slugs) : [];
    return {
      cacheDir: this.cacheDir,
      indexExists: Boolean(index),
      indexGeneratedAt: index?.generatedAt ?? null,
      publishedBoardsCount: entries.length,
      indexedBoardsCount: entries.filter((e) => e.indexing).length,
    };
  }
}
