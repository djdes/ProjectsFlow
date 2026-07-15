import assert from 'node:assert/strict';
import { validateHeaderValue } from 'node:http';
import test from 'node:test';

import { contentDisposition } from './contentDisposition.js';

test('Content-Disposition safely serves a Cyrillic screenshot filename', () => {
  const header = contentDisposition('изображение.png', true);

  assert.doesNotThrow(() => validateHeaderValue('Content-Disposition', header));
  assert.match(header, /^inline; filename="_+\.png";/);
  assert.match(
    header,
    /filename\*=UTF-8''%D0%B8%D0%B7%D0%BE%D0%B1%D1%80%D0%B0%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5\.png$/,
  );
});

test('Content-Disposition strips control characters from both filename parameters', () => {
  const header = contentDisposition('screen\r\n"one".png', false);

  assert.doesNotThrow(() => validateHeaderValue('Content-Disposition', header));
  assert.equal(header.includes('\r'), false);
  assert.equal(header.includes('\n'), false);
  assert.match(header, /^attachment; filename="screen___one_\.png";/);
  assert.match(header, /filename\*=UTF-8''screen__%22one%22\.png$/);
});
