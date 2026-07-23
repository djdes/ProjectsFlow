import test from 'node:test';
import assert from 'node:assert/strict';
import { CommitSyncScheduler } from './CommitSyncScheduler.js';

// Планировщик читает МSK-время из системных часов, поэтому тесты держат фиктивную «текущую
// минуту/день» через подменённый Intl? Нет — проще прогонять runTick через доступ к времени
// невозможно (mskNow берёт new Date()). Здесь проверяем ЧИСТУЮ логику отбора, вызывая tick и
// управляя тем, что вернёт listCommitSyncEnabled: если проект «должен был вчера» (lastRunOn в
// прошлом) и сегодня его день — он ставится; в чужой день — нет. Время берём реальное, поэтому
// час/минуту не проверяем (schedMin=0 всегда прошёл), фокус на дне недели и дедупе.

function mskDayToday(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const [y, m, d] = `${get('year')}-${get('month')}-${get('day')}`.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d!)).getUTCDay();
}

function harness(days: number[]) {
  const enqueued: string[] = [];
  const marked: string[] = [];
  const scheduler = new CommitSyncScheduler({
    automation: {
      async listCommitSyncEnabled() {
        return [{ projectId: 'p1', hour: 0, minute: 0, daysOfWeek: days, lastRunOn: null }];
      },
      async markCommitSyncRun(projectId: string) {
        marked.push(projectId);
      },
    } as never,
    enqueue: {
      async execute(projectId: string) {
        enqueued.push(projectId);
        return { id: 'job1' } as never;
      },
    } as never,
  });
  return { scheduler, enqueued, marked };
}

test('в разрешённый день сверка ставится (час 00:00 уже прошёл)', async () => {
  const today = mskDayToday();
  const h = harness([today]);
  await h.scheduler.tick();
  assert.deepEqual(h.enqueued, ['p1']);
  assert.deepEqual(h.marked, ['p1']); // дата помечена, чтобы не ретраить каждую минуту
});

test('в НЕ разрешённый день недели сверка не ставится', async () => {
  const today = mskDayToday();
  const other = (today + 1) % 7;
  const h = harness([other]);
  await h.scheduler.tick();
  assert.deepEqual(h.enqueued, []);
  assert.deepEqual(h.marked, []); // не тот день — даже дату не трогаем
});

test('пустой список дней = сверка не запускается (защита через parse делает это [все дни], но на всякий)', async () => {
  // На уровне репозитория пустой/NULL нормализуется в «каждый день», но сам планировщик
  // на буквально пустой массив обязан промолчать, а не упасть.
  const h = harness([]);
  await h.scheduler.tick();
  assert.deepEqual(h.enqueued, []);
});
