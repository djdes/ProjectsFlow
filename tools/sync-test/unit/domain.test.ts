import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateManifestPath,
  computePathHash,
  findCaseCollision,
} from '../../../server/src/domain/file-sync/paths.ts';
import {
  canonicalManifestSha,
  canonicalIgnoreSetHash,
  type ManifestEntry,
} from '../../../server/src/domain/file-sync/manifest.ts';
import {
  diffManifests,
  resolveConflict,
  countChanges,
  type ChangeOp,
} from '../../../server/src/domain/file-sync/changeSet.ts';

const f = (path: string, sha: string | null, opts: Partial<ManifestEntry> = {}): ManifestEntry => ({
  path,
  sha256: sha,
  size: opts.size ?? (sha ? 10 : 0),
  mode: opts.mode ?? 0,
  mtimeMs: opts.mtimeMs ?? 0,
  isSymlink: opts.isSymlink ?? false,
  symlinkTarget: opts.symlinkTarget ?? null,
});

test('validateManifestPath accepts normal relative POSIX paths', () => {
  for (const p of ['a.txt', 'src/index.ts', 'a/b/c/d.json', 'папка/файл.md', 'x.config']) {
    assert.doesNotThrow(() => validateManifestPath(p), `should accept ${p}`);
  }
});

test('validateManifestPath rejects dangerous paths', () => {
  const bad = [
    'foo\\bar', // backslash
    '../etc/passwd', // parent
    'a/../b', // parent mid-path
    '/abs/path', // leading slash
    'C:/Windows', // drive letter (colon)
    '//server/share', // UNC -> empty first segment
    'a//b', // double slash
    'a/b/', // trailing slash -> empty segment
    'con', // reserved
    'CON.txt', // reserved with ext
    'nul', // reserved
    'com1', // reserved
    'a/aux/b', // reserved mid
    'trailingdot.', // ends with dot
    'trailingspace ', // ends with space
    'has\0nul', // NUL
  ];
  for (const p of bad) {
    assert.throws(() => validateManifestPath(p), `should reject ${JSON.stringify(p)}`);
  }
});

test('computePathHash is stable and case-sensitive', () => {
  assert.equal(computePathHash('a/b'), computePathHash('a/b'));
  assert.notEqual(computePathHash('a/b'), computePathHash('a/B'));
});

test('findCaseCollision detects case-only duplicates', () => {
  assert.equal(findCaseCollision(['a', 'b', 'c']), null);
  const c = findCaseCollision(['README.md', 'src/x', 'Readme.md']);
  assert.ok(c);
  assert.deepEqual([...c].sort(), ['README.md', 'Readme.md'].sort());
});

test('canonicalManifestSha is order-independent', () => {
  const a = [f('a', '1'), f('b', '2'), f('z/y', '3')];
  const b = [f('z/y', '3'), f('a', '1'), f('b', '2')];
  assert.equal(canonicalManifestSha(a), canonicalManifestSha(b));
});

test('canonicalManifestSha ignores mtime but reacts to content/mode/size/symlink', () => {
  const base = [f('a', '1', { mtimeMs: 100 })];
  const sameContentDiffMtime = [f('a', '1', { mtimeMs: 999 })];
  assert.equal(canonicalManifestSha(base), canonicalManifestSha(sameContentDiffMtime), 'mtime must not matter');

  assert.notEqual(canonicalManifestSha(base), canonicalManifestSha([f('a', '2')]), 'sha matters');
  assert.notEqual(canonicalManifestSha(base), canonicalManifestSha([f('a', '1', { mode: 1 })]), 'mode matters');
  assert.notEqual(canonicalManifestSha(base), canonicalManifestSha([f('a', '1', { size: 20 })]), 'size matters');

  const link1 = [f('l', null, { isSymlink: true, symlinkTarget: 'x' })];
  const link2 = [f('l', null, { isSymlink: true, symlinkTarget: 'y' })];
  assert.notEqual(canonicalManifestSha(link1), canonicalManifestSha(link2), 'symlink target matters');
});

// Замороженный вектор: его обязаны воспроизводить C#/PowerShell/TS реализации.
// Сериализация: ordinal(utf8) sort путей; строка `path \0 contentToken \0 mode \0 size \n`.
const FROZEN_VECTOR = '5cb40a2db1e2cef89fda97122bbb47f2fe9ce8c2abec88dee0366cf934a2aec8';
test('canonicalManifestSha matches a frozen test vector (cross-impl contract)', () => {
  const m = [f('src/b.ts', 'bbb', { mode: 0, size: 3 }), f('a.txt', 'aaa', { mode: 1, size: 5 })];
  const got = canonicalManifestSha(m);
  assert.match(got, /^[0-9a-f]{64}$/);
  assert.equal(got, canonicalManifestSha([...m].reverse()), 'order-independent');
  assert.equal(got, FROZEN_VECTOR, 'serialization changed — update ALL impls (C#/PS/TS)');
});

test('canonicalIgnoreSetHash is order-independent and deterministic', () => {
  assert.equal(
    canonicalIgnoreSetHash(['node_modules', '.git', 'dist']),
    canonicalIgnoreSetHash(['dist', '.git', 'node_modules']),
  );
  assert.match(canonicalIgnoreSetHash(['a']), /^[0-9a-f]{64}$/);
});

test('diffManifests computes add/modify/delete correctly', () => {
  const base = [f('keep', '1'), f('mod', '2'), f('gone', '3')];
  const head = [f('keep', '1'), f('mod', '2x'), f('new', '4')];
  const ops = diffManifests(base, head);
  const byPath = new Map(ops.map((o) => [o.path, o]));
  assert.equal(byPath.get('new')?.op, 'add');
  assert.equal(byPath.get('mod')?.op, 'modify');
  assert.equal(byPath.get('gone')?.op, 'delete');
  assert.equal(byPath.has('keep'), false, 'unchanged file produces no op');
  assert.deepEqual(countChanges(ops), { added: 1, modified: 1, deleted: 1 });
});

test('diffManifests treats mode-only change as modify', () => {
  const ops = diffManifests([f('s', '1', { mode: 0 })], [f('s', '1', { mode: 1 })]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0]?.op, 'modify');
});

test('resolveConflict: never-clobber 3-way semantics', () => {
  const mod = (base: string | null, head: string | null): ChangeOp => ({
    op: 'modify',
    path: 'p',
    baseSha: base,
    headSha: head,
    mode: 0,
    size: 1,
    isSymlink: false,
    symlinkTarget: null,
  });
  // L==B, D!=B -> apply (safe fast-forward)
  assert.equal(resolveConflict(mod('B', 'D'), 'B'), 'apply');
  // L==D -> noop (converged)
  assert.equal(resolveConflict(mod('B', 'D'), 'D'), 'noop');
  // L!=B && L!=D && both diverged -> conflict (never clobber local edit)
  assert.equal(resolveConflict(mod('B', 'D'), 'LOCAL'), 'conflict');
  // user deleted a file Ralph modified -> conflict
  assert.equal(resolveConflict(mod('B', 'D'), null), 'conflict');
});

test('resolveConflict: delete + add semantics', () => {
  const del: ChangeOp = { op: 'delete', path: 'p', baseSha: 'B' };
  assert.equal(resolveConflict(del, 'B'), 'delete-local'); // unchanged -> delete (to trash)
  assert.equal(resolveConflict(del, null), 'noop'); // already gone
  assert.equal(resolveConflict(del, 'EDITED'), 'conflict'); // edited locally -> keep

  const add: ChangeOp = {
    op: 'add',
    path: 'p',
    headSha: 'D',
    mode: 0,
    size: 1,
    isSymlink: false,
    symlinkTarget: null,
  };
  assert.equal(resolveConflict(add, null), 'apply'); // not present -> create
  assert.equal(resolveConflict(add, 'D'), 'noop'); // already same
  assert.equal(resolveConflict(add, 'OTHER'), 'conflict'); // local different file at path
});
