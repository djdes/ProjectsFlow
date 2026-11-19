import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillDays, forecastDaily } from './forecast.js';

test('прогноз продолжает растущий тренд и даёт вилку вокруг него', () => {
  const series = fillDays('2026-09-01', '2026-10-27', new Map()).map((p, i) => ({ ...p, value: 10 + i }));
  const f = forecastDaily(series, 30);
  assert.equal(f.length, 30);
  assert.equal(f[0]!.day, '2026-10-28');
  // Чистая прямая: прогноз = продолжение, вилка схлопывается.
  assert.ok(Math.abs(f[0]!.value - (10 + 57)) < 0.5);
  assert.ok(f[29]!.value > f[0]!.value);
  assert.ok(f[0]!.low <= f[0]!.value && f[0]!.value <= f[0]!.high);
});

test('мало данных — прогноза нет; ниже нуля не уходит', () => {
  assert.deepEqual(forecastDaily(fillDays('2026-10-01', '2026-10-05', new Map()), 30), []);
  const falling = fillDays('2026-09-01', '2026-10-27', new Map()).map((p, i) => ({ ...p, value: Math.max(0, 50 - i) }));
  assert.ok(forecastDaily(falling, 30).every((p) => p.value >= 0 && p.low >= 0));
});

test('fillDays дополняет пропущенные дни нулями', () => {
  const s = fillDays('2026-10-01', '2026-10-03', new Map([['2026-10-02', 5]]));
  assert.deepEqual(s.map((p) => p.value), [0, 5, 0]);
});
