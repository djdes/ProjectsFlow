import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasExplicitAssignee, mixedRouteOf } from './mixedRouting.js';

test('смешанная группа: исполнитель — @username, @Имя или «@мне»', () => {
  assert.equal(mixedRouteOf('поправить плеер @djdes'), 'person');
  assert.equal(mixedRouteOf('@Денис обновить сборку Yesbeat'), 'person');
  assert.equal(mixedRouteOf('+Yesbeat проверить логи @мне'), 'person');
});

test('смешанная группа: без исполнителя — воркеру; «@воркер» и голое «мне» — не исполнитель', () => {
  assert.equal(mixedRouteOf('в конфиге не сохраняется тариф'), 'worker');
  assert.equal(mixedRouteOf('мне нужно, чтобы скрипт перезапускался'), 'worker');
  assert.equal(mixedRouteOf('@воркер почини FilterMusic'), 'worker');
  assert.equal(mixedRouteOf('@ralph почини FilterMusic'), 'worker');
  assert.equal(hasExplicitAssignee('письмо на a@b.ru не ушло'), false);
  assert.equal(hasExplicitAssignee('кто-нибудь @ посмотрите'), false);
});
