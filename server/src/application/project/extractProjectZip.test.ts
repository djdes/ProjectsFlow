import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectArchiveInvalidError } from '../../domain/project/errors.js';
import { extractProjectZip } from './extractProjectZip.js';

function storedZip(entries: ReadonlyArray<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const centralBody = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBody.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBody, eocd]);
}

test('extractProjectZip unpacks binary-safe files and removes a common wrapper folder', () => {
  const files = extractProjectZip(storedZip([
    { name: 'my-project/package.json', content: '{"name":"demo"}' },
    { name: 'my-project/src/index.ts', content: 'export {};' },
  ]));
  assert.deepEqual(files.map((file) => file.path), ['package.json', 'src/index.ts']);
  assert.equal(files[0]!.content.toString('utf8'), '{"name":"demo"}');
});

test('extractProjectZip rejects traversal paths before extracting', () => {
  assert.throws(
    () => extractProjectZip(storedZip([{ name: '../secret.txt', content: 'nope' }])),
    ProjectArchiveInvalidError,
  );
});
