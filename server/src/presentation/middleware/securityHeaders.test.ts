import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { securityHeaders } from './securityHeaders.js';

function run(hostname: string): Map<string, string> {
  const headers = new Map<string, string>();
  const req = { hostname } as Request;
  const res = {
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    removeHeader(name: string) { headers.delete(name.toLowerCase()); },
  } as unknown as Response;
  let continued = false;
  securityHeaders('projectsflow.ru')(req, res, () => { continued = true; });
  assert.equal(continued, true);
  return headers;
}

test('основное приложение нельзя встраивать во фрейм', () => {
  const headers = run('projectsflow.ru');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('content-security-policy'), "frame-ancestors 'none'");
});

test('результат проекта можно встроить только в ProjectsFlow', () => {
  const headers = run('future-shop.projectsflow.ru');
  assert.equal(headers.has('x-frame-options'), false);
  assert.equal(
    headers.get('content-security-policy'),
    'frame-ancestors https://projectsflow.ru https://www.projectsflow.ru',
  );
});

test('зарезервированные поддомены остаются защищёнными', () => {
  for (const hostname of ['www.projectsflow.ru', 'api.projectsflow.ru', 'app.projectsflow.ru']) {
    assert.equal(run(hostname).get('x-frame-options'), 'DENY');
  }
});
