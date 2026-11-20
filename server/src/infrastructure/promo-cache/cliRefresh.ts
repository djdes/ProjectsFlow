import { DrizzleProjectRepository } from '../repositories/DrizzleProjectRepository.js';
import { DrizzleTaskRepository } from '../repositories/DrizzleTaskRepository.js';
import { DrizzleTaskCommentRepository } from '../repositories/DrizzleTaskCommentRepository.js';
import { DrizzleUserRepository } from '../repositories/DrizzleUserRepository.js';
import { FilePublicBoardSnapshotCache, resolvePromoCacheDir } from './FilePublicBoardSnapshotCache.js';
import type { PromoCacheStatusSummary } from '../../application/project/PublicBoardSnapshotCache.js';

export function readPromoCacheStatusOnly(): PromoCacheStatusSummary {
  const cache = new FilePublicBoardSnapshotCache({
    projects: {} as never,
    tasks: {} as never,
    comments: {} as never,
    users: {} as never,
    cacheDir: resolvePromoCacheDir(),
  });
  return cache.status();
}

export async function runPromoCacheCliRefresh(): Promise<PromoCacheStatusSummary> {
  const { db, pool } = await import('../db/index.js');
  try {
    const cache = new FilePublicBoardSnapshotCache({
      projects: new DrizzleProjectRepository(db),
      tasks: new DrizzleTaskRepository(db),
      comments: new DrizzleTaskCommentRepository(db),
      users: new DrizzleUserRepository(db),
    });
    return await cache.refreshAll();
  } finally {
    await pool.end().catch(() => {});
  }
}
