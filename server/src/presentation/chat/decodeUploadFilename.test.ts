import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeUploadFilename } from './routes.js';

test('decodeUploadFilename: восстанавливает кириллицу, которую multer прочитал как latin1', () => {
  const raw = Buffer.from('Договор_Зерно.pdf', 'utf8').toString('latin1');
  assert.equal(decodeUploadFilename(raw), 'Договор_Зерно.pdf');
});

test('decodeUploadFilename: ASCII-имя не меняется', () => {
  assert.equal(decodeUploadFilename('screen.png'), 'screen.png');
});
