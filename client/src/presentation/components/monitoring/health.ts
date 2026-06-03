// Единый источник правды по «цвету здоровья»: пороги + соответствие тон → Tailwind-класс.
// Раньше эта логика дублировалась в ResourceBar (90/75), ServerCard (SSL 14/30, HTTP, restart),
// StatusBadge (STATUS_META). Теперь все визуализации мониторинга берут цвет отсюда — один warn
// выглядит одинаково везде и при добавлении новых виджетов оттенки не разъезжаются.
import type { ServerHealthStatus } from '@/domain/monitoring/Snapshot';
import type { AlertSeverity } from '@/domain/monitoring/Alert';

export type HealthTone = 'ok' | 'warn' | 'crit' | 'idle';

// Пороги загрузки (диск/CPU/RAM/swap), %.
export const PCT_WARN = 75;
export const PCT_CRIT = 90;
// Пороги срока SSL-сертификата, дней.
export const SSL_CRIT_DAYS = 14;
export const SSL_WARN_DAYS = 30;
// «Недавно перезапущен» — аптайм процесса меньше этого считаем подозрительным.
export const RECENT_RESTART_MS = 10 * 60 * 1000;

export function pctTone(pct: number | null | undefined): HealthTone {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'idle';
  if (pct >= PCT_CRIT) return 'crit';
  if (pct >= PCT_WARN) return 'warn';
  return 'ok';
}

export function sslTone(daysLeft: number | null | undefined): HealthTone {
  if (daysLeft === null || daysLeft === undefined) return 'idle';
  if (daysLeft <= SSL_CRIT_DAYS) return 'crit';
  if (daysLeft <= SSL_WARN_DAYS) return 'warn';
  return 'ok';
}

export function statusTone(status: ServerHealthStatus): HealthTone {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'degraded':
      return 'warn';
    case 'down':
      return 'crit';
    default:
      return 'idle'; // stale | unknown
  }
}

// Заливка прогресс-бара. ok = нейтрально-активный sky (как было исторически), не зелёный —
// чтобы «нормальная» полоса не выглядела как «успех-действие».
export function barFillClass(tone: HealthTone): string {
  switch (tone) {
    case 'crit':
      return 'bg-red-500';
    case 'warn':
      return 'bg-amber-500';
    case 'ok':
      return 'bg-sky-500';
    default:
      return 'bg-muted-foreground/30';
  }
}

// Цвет текста для inline-метрик (числа в компактной строке). ok/idle — наследуем (без акцента).
export function metricTextClass(tone: HealthTone): string {
  switch (tone) {
    case 'crit':
      return 'text-red-600 dark:text-red-400';
    case 'warn':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return '';
  }
}

// Мягкая «таблетка» bg/15 + текст — для статус-бейджей и HTTP/SSL-чипов.
export function toneChipClass(tone: HealthTone): string {
  switch (tone) {
    case 'ok':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'warn':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'crit':
      return 'bg-red-500/15 text-red-600 dark:text-red-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

// Severity у алертов имеет свою палитру: info = sky (а не зелёный ok).
export function severityChipClass(severity: AlertSeverity): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-500/15 text-red-600 dark:text-red-400';
    case 'warning':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    default:
      return 'bg-sky-500/15 text-sky-600 dark:text-sky-400';
  }
}

// Цветная точка-индикатор статуса (компактная строка/обзор).
export function statusDotClass(status: ServerHealthStatus): string {
  switch (statusTone(status)) {
    case 'ok':
      return 'bg-emerald-500';
    case 'warn':
      return 'bg-amber-500';
    case 'crit':
      return 'bg-red-500';
    default:
      return 'bg-muted-foreground/40';
  }
}
