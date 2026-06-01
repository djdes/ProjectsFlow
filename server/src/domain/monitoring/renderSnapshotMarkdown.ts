import type { ServerSnapshot } from './ServerSnapshot.js';

// Рендер снимка в markdown для KB. ВАЖНО: только метрики/проценты/счётчики — НИКОГДА
// строки логов (KB читаем editor'ом, шире чем owner-only мониторинг → логи = утечка).
// Возвращает frontmatter (type='monitoring') + body. Значения frontmatter совместимы
// с KB Frontmatter (string | number | boolean | null).

type FmValue = string | number | boolean | null;

function fmtBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtPct(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : `${Math.round(n)}%`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

export type RenderedMonitoringDoc = {
  readonly frontmatter: Record<string, FmValue>;
  readonly body: string;
};

export function renderSnapshotMarkdown(input: {
  readonly serverName: string;
  readonly snapshot: ServerSnapshot;
  readonly activeAlerts: ReadonlyArray<{ readonly severity: string; readonly message: string }>;
}): RenderedMonitoringDoc {
  const { serverName, snapshot, activeAlerts } = input;
  const m = snapshot.metrics;
  const lines: string[] = [];

  lines.push(`# Мониторинг — ${serverName}`);
  lines.push('');
  lines.push(`Снимок от **${snapshot.collectedAt.toISOString()}** · статус: **${snapshot.status}** · источник: ${snapshot.source}`);
  lines.push('');

  // pm2
  lines.push('## Процессы pm2');
  lines.push('');
  if (m && m.pm2.length > 0) {
    lines.push('| Процесс | Статус | Аптайм | Рестарты | CPU | Память |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const p of m.pm2) {
      lines.push(
        `| ${p.name} | ${p.status} | ${fmtDuration(p.uptimeMs)} | ${p.restarts ?? '—'} | ${p.cpuPct === null ? '—' : `${p.cpuPct}%`} | ${fmtBytes(p.memoryBytes)} |`,
      );
    }
  } else {
    lines.push('_Нет данных pm2._');
  }
  lines.push('');

  // система
  lines.push('## Система');
  lines.push('');
  if (m?.system) {
    const s = m.system;
    lines.push('| Метрика | Значение |');
    lines.push('| --- | --- |');
    lines.push(`| Load average | ${s.load1 ?? '—'} / ${s.load5 ?? '—'} / ${s.load15 ?? '—'} |`);
    lines.push(`| CPU (ядер) | ${s.cpuCount ?? '—'} |`);
    lines.push(`| Память | ${fmtPct(s.memUsedPct)} (${fmtBytes(s.memUsedBytes)} / ${fmtBytes(s.memTotalBytes)}) |`);
    lines.push(`| Аптайм | ${s.uptimeSeconds === null ? '—' : fmtDuration(s.uptimeSeconds * 1000)} |`);
    lines.push('');
    if (s.disks.length > 0) {
      lines.push('### Диски');
      lines.push('');
      lines.push('| Раздел | Занято | Всего | % |');
      lines.push('| --- | --- | --- | --- |');
      for (const d of s.disks) {
        lines.push(`| ${d.mount} | ${fmtBytes(d.usedBytes)} | ${fmtBytes(d.totalBytes)} | ${fmtPct(d.usedPct)} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('_Нет системных метрик._');
    lines.push('');
  }

  // алерты
  lines.push('## Активные алерты');
  lines.push('');
  if (activeAlerts.length > 0) {
    for (const a of activeAlerts) {
      lines.push(`- **[${a.severity}]** ${a.message}`);
    }
  } else {
    lines.push('_Активных алертов нет._');
  }
  lines.push('');

  return {
    frontmatter: {
      type: 'monitoring',
      title: `Мониторинг — ${serverName}`,
      server: serverName,
      status: snapshot.status,
      captured_at: snapshot.collectedAt.toISOString(),
    },
    body: lines.join('\n'),
  };
}
