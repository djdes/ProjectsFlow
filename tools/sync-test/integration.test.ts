// Интеграционный тест file-sync движка против РЕАЛЬНОЙ тестовой БД (projectsflow_synctest).
// Запуск (см. run-integration.ps1): DATABASE_URL должен указывать на тестовую БД.
//   $env:DATABASE_URL='mysql://projectsflow:PASS@127.0.0.1:3306/projectsflow_synctest'
//   node --import tsx --test tools/sync-test/integration.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pool, db } from '../../server/src/infrastructure/db/index.ts';
import { DrizzleProjectRepository } from '../../server/src/infrastructure/repositories/DrizzleProjectRepository.ts';
import { DrizzleProjectMemberRepository } from '../../server/src/infrastructure/repositories/DrizzleProjectMemberRepository.ts';
import { DrizzleFileSyncRepository } from '../../server/src/infrastructure/repositories/DrizzleFileSyncRepository.ts';
import { FileSystemBlobStorage } from '../../server/src/infrastructure/storage/FileSystemBlobStorage.ts';
import { FileSyncService } from '../../server/src/application/file-sync/FileSyncService.ts';
import { resolveConflict } from '../../server/src/domain/file-sync/changeSet.ts';
import type { ManifestEntry } from '../../server/src/domain/file-sync/manifest.ts';

const blobs = mkdtempSync(join(tmpdir(), 'pf-sync-blobs-'));
const clock = { ms: Date.now() };

function sha(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}
function entry(path: string, content: string | null, opts: Partial<ManifestEntry> = {}): ManifestEntry {
  const s = content === null ? null : sha(content);
  return {
    path,
    sha256: s,
    size: content === null ? 0 : Buffer.byteLength(content),
    mode: opts.mode ?? 0,
    mtimeMs: opts.mtimeMs ?? clock.ms,
    isSymlink: opts.isSymlink ?? false,
    symlinkTarget: opts.symlinkTarget ?? null,
  };
}

const fsRepo = new DrizzleFileSyncRepository(db);
const projects = new DrizzleProjectRepository(db);
const members = new DrizzleProjectMemberRepository(db);
const storage = new FileSystemBlobStorage(blobs);

function makeService(): FileSyncService {
  return new FileSyncService({
    projects,
    members,
    repo: fsRepo,
    storage,
    idGen: () => randomUUID(),
    now: () => new Date(clock.ms),
    serverIgnoreSet: ['node_modules', '.git', 'dist'],
    draftPinTtlSeconds: 60,
    maxBlobBytes: 100 * 1024 * 1024,
  });
}

async function seedProject(): Promise<{ projectId: string; userId: string }> {
  const projectId = randomUUID();
  const userId = randomUUID();
  await pool.query(
    'INSERT INTO projects (id, owner_id, name, status, kb_kind, finance_visibility, dispatcher_user_id, is_inbox) VALUES (?,?,?,?,?,?,?,?)',
    [projectId, userId, 'synctest-' + projectId.slice(0, 8), 'active', 'none', 'owner', userId, 0],
  );
  await pool.query('INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)', [
    projectId,
    userId,
    'owner',
  ]);
  return { projectId, userId };
}

// Полный happy-path round-trip + never-clobber.
async function uploadAndSeal(
  svc: FileSyncService,
  projectId: string,
  userId: string,
  source: 'client' | 'dispatcher',
  entries: ManifestEntry[],
  contents: Map<string, string>,
): Promise<string> {
  const draft = await svc.createSnapshotDraft(projectId, userId, { source, entries });
  for (const shaHex of draft.missingBlobs) {
    // найти контент по sha
    let body: string | undefined;
    for (const [, c] of contents) if (sha(c) === shaHex) body = c;
    assert.ok(body !== undefined, `content for blob ${shaHex} must be known`);
    await svc.uploadBlob(projectId, userId, shaHex, Buffer.from(body, 'utf8'), source);
  }
  const sealed = await svc.sealSnapshot(projectId, userId, draft.snapshotId, source);
  assert.match(sealed.manifestSha, /^[0-9a-f]{64}$/);
  return draft.snapshotId;
}

test('full round-trip: baseline -> dispatcher result -> changeset -> ack advances base', async () => {
  const svc = makeService();
  const { projectId, userId } = await seedProject();

  await svc.ensureWorkspace(projectId, userId, 'test');

  // baseline (client): a.txt, src/b.txt, gone.txt
  const baseContents = new Map([
    ['a.txt', 'AAA'],
    ['src/b.txt', 'BBB'],
    ['gone.txt', 'GONE'],
  ]);
  const baseEntries = [...baseContents].map(([p, c]) => entry(p, c));
  const baseId = await uploadAndSeal(svc, projectId, userId, 'client', baseEntries, baseContents);

  let ws = await svc.getWorkspace(projectId, userId);
  assert.equal(ws.baseSnapshotId, baseId, 'first client snapshot becomes base');

  // session
  const session = await svc.openSession(projectId, userId, { baseSnapshotId: baseId, idempotencyKey: 'k1' });
  // идемпотентность openSession
  const session2 = await svc.openSession(projectId, userId, { baseSnapshotId: baseId, idempotencyKey: 'k1' });
  assert.equal(session2.id, session.id, 'openSession idempotent on idempotencyKey');

  // dispatcher result: a.txt modified, src/b.txt unchanged, gone.txt deleted, new.txt added
  const resultContents = new Map([
    ['a.txt', 'AAA-modified'],
    ['src/b.txt', 'BBB'],
    ['new.txt', 'NEW'],
  ]);
  const resultEntries = [...resultContents].map(([p, c]) => entry(p, c));
  const resultId = await uploadAndSeal(svc, projectId, userId, 'dispatcher', resultEntries, resultContents);

  // dedup: src/b.txt (BBB) уже есть → НЕ в missingBlobs повторного draft'а
  const reDraft = await svc.createSnapshotDraft(projectId, userId, { source: 'dispatcher', entries: resultEntries });
  assert.equal(reDraft.missingBlobs.includes(sha('BBB')), false, 'existing blob deduped (not requested again)');

  const rec = await svc.recordSnapshotResult(projectId, userId, session.id, resultId);
  assert.equal(rec.status, 'result_ready');
  assert.deepEqual(rec.changeCounts, { added: 1, modified: 1, deleted: 1 });

  ws = await svc.getWorkspace(projectId, userId);
  assert.equal(ws.pendingApply, true, 'pendingApply set after result');
  assert.equal(ws.dispatcherHeadSnapshotId, resultId);

  // change-set + never-clobber: пользователь локально изменил a.txt во время прогона
  const cs = await svc.getChangeSet(projectId, userId, baseId, resultId);
  const aMod = cs.ops.find((o) => o.path === 'a.txt');
  assert.ok(aMod && aMod.op === 'modify');
  // L (локально) != B и != D → conflict, НИКОГДА не перезаписываем
  assert.equal(resolveConflict(aMod, sha('AAA-локальная-правка')), 'conflict');
  // gone.txt: удалён диспетчером, локально нетронут (== base) → delete-local (в .pf-trash)
  const del = cs.ops.find((o) => o.path === 'gone.txt');
  assert.ok(del && del.op === 'delete');
  assert.equal(resolveConflict(del, sha('GONE')), 'delete-local');

  // ack applied → base advances (CAS)
  const before = await svc.getWorkspace(projectId, userId);
  const ack = await svc.ackSession(projectId, userId, session.id, 'applied');
  assert.equal(ack.baseAdvanced, true);
  const afterAck = await svc.getWorkspace(projectId, userId);
  assert.equal(afterAck.baseSnapshotId, resultId, 'base advanced to result');
  assert.equal(afterAck.baseVersion, before.baseVersion + 1, 'base_version incremented');
  assert.equal(afterAck.pendingApply, false, 'pendingApply cleared on apply');
});

test('CAS base pointer is single-writer (stale expected version fails)', async () => {
  await seedProject();
  const { projectId, userId } = await seedProject();
  const svc = makeService();
  await svc.ensureWorkspace(projectId, userId, null);
  const c = new Map([['x.txt', 'X']]);
  const s1 = await uploadAndSeal(svc, projectId, userId, 'client', [entry('x.txt', 'X')], c);
  const c2 = new Map([['x.txt', 'X2']]);
  const s2 = await uploadAndSeal(svc, projectId, userId, 'client', [entry('x.txt', 'X2')], c2);

  const ws = await svc.getWorkspace(projectId, userId);
  const v = ws.baseVersion;
  const first = await fsRepo.casAdvanceBase(ws.id, v, s1);
  assert.equal(first, true, 'first CAS at version v succeeds');
  const stale = await fsRepo.casAdvanceBase(ws.id, v, s2);
  assert.equal(stale, false, 'second CAS at stale version v fails (single-writer)');
});

test('ignore-set mismatch between base and result is rejected (data-loss guard)', async () => {
  const { projectId, userId } = await seedProject();
  const svc = makeService();
  await svc.ensureWorkspace(projectId, userId, null);
  const baseC = new Map([['f', 'F']]);
  const baseId = await uploadAndSeal(svc, projectId, userId, 'client', [entry('f', 'F')], baseC);
  const session = await svc.openSession(projectId, userId, { baseSnapshotId: baseId });
  const resC = new Map([['f', 'F2']]);
  const resId = await uploadAndSeal(svc, projectId, userId, 'dispatcher', [entry('f', 'F2')], resC);
  // искусственно портим ignore_set_hash результата → должно отвергнуться
  await pool.query('UPDATE sync_snapshots SET ignore_set_hash = ? WHERE id = ?', ['deadbeef', resId]);
  await assert.rejects(
    () => svc.recordSnapshotResult(projectId, userId, session.id, resId),
    /IgnoreSetMismatch/,
  );
});

test('path validator rejects dangerous paths at draft creation', async () => {
  const { projectId, userId } = await seedProject();
  const svc = makeService();
  await svc.ensureWorkspace(projectId, userId, null);
  await assert.rejects(
    () => svc.createSnapshotDraft(projectId, userId, { source: 'client', entries: [entry('../escape', 'X')] }),
    /InvalidManifestPath/,
  );
});

test('GC pinning: pinned blob survives prune; expired+unreferenced blob is collected', async () => {
  const { projectId, userId } = await seedProject();
  const svc = makeService();
  await svc.ensureWorkspace(projectId, userId, null);

  const content = 'GC-' + randomUUID();
  const shaHex = sha(content);
  const draft = await svc.createSnapshotDraft(projectId, userId, { source: 'client', entries: [entry('g.txt', content)] });
  await svc.uploadBlob(projectId, userId, shaHex, Buffer.from(content, 'utf8'), 'client');
  // abort draft → снепшот больше не «non-aborted», но блоб ещё запинен (pin = NOW()+60s).
  await fsRepo.setSnapshotStatus(draft.snapshotId, 'aborted');

  // prune при текущем времени БД: pin в будущем → блоб НЕ собирается.
  await svc.pruneExpired(0, 100);
  assert.equal((await fsRepo.presentBlobShas([shaHex])).has(shaHex), true, 'pinned blob survives prune');
  assert.equal(await storage.has(shaHex), true, 'pinned blob file still on disk');

  // форсируем истечение пина (вместо ожидания) → блоб (ref0, pin истёк, снепшот aborted) собирается.
  await pool.query('UPDATE sync_blobs SET pinned_until = (NOW() - INTERVAL 1 HOUR) WHERE sha256 = ?', [shaHex]);
  const res = await svc.pruneExpired(0, 100);
  assert.ok(res.deletedBlobs >= 1, 'expired unreferenced blob collected');
  assert.equal((await fsRepo.presentBlobShas([shaHex])).has(shaHex), false, 'blob row deleted');
  assert.equal(await storage.has(shaHex), false, 'blob file deleted from disk');
});

test('progress events are append-only and idempotent on (taskId, seq)', async () => {
  const { projectId, userId } = await seedProject();
  const svc = makeService();
  const taskId = randomUUID();
  const r1 = await svc.appendProgressEvents(projectId, userId, taskId, [
    { seq: 1, kind: 'status', text: 'started' },
    { seq: 2, kind: 'tool', text: 'editing a.txt' },
  ]);
  assert.equal(r1.appended, 2);
  // повтор seq=2 (идемпотентно) + новый seq=3
  const r2 = await svc.appendProgressEvents(projectId, userId, taskId, [
    { seq: 2, kind: 'tool', text: 'dup' },
    { seq: 3, kind: 'done', text: 'finished' },
  ]);
  assert.equal(r2.appended, 1, 'duplicate seq ignored');
  const list = await svc.listProgressEvents(projectId, userId, taskId, 0, 100);
  assert.equal(list.events.length, 3);
  assert.deepEqual(list.events.map((e) => e.seq), [1, 2, 3]);
});

after(async () => {
  try { await pool.end(); } catch {}
  try { rmSync(blobs, { recursive: true, force: true }); } catch {}
});
