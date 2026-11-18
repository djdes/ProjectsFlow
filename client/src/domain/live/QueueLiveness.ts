import { RUN_MODE_META } from '../task/Task';

// «Живость» ожидания в LIVE, пока задача в очереди воркера: сколько ждём и видел ли
// диспетчер очередь. Чистые функции — время передаётся явно (тесты, таймер в UI).

export type DispatcherHeartbeat = {
  readonly dispatcherAssigned: boolean;
  // Последний запрос агента-диспетчера к API; null — с trackedSince запросов не было.
  readonly lastSeenAt: Date | null;
  // С какого момента сервер следит (рестарт процесса обнуляет данные).
  readonly trackedSince: Date;
};

// Диспетчер опрашивает очередь раз в минуту-две; 3 минуты тишины — повод насторожиться.
export const DISPATCHER_OFFLINE_AFTER_MS = 3 * 60_000;

export type DispatcherPulse =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unassigned' }
  | { readonly kind: 'seen'; readonly secondsAgo: number }
  | { readonly kind: 'offline'; readonly secondsAgo: number | null };

export function dispatcherPulse(heartbeat: DispatcherHeartbeat | null, now: Date): DispatcherPulse {
  if (!heartbeat) return { kind: 'unknown' };
  if (!heartbeat.dispatcherAssigned) return { kind: 'unassigned' };
  const nowMs = now.getTime();
  if (heartbeat.lastSeenAt) {
    const ago = Math.max(0, nowMs - heartbeat.lastSeenAt.getTime());
    const secondsAgo = Math.floor(ago / 1000);
    return ago > DISPATCHER_OFFLINE_AFTER_MS ? { kind: 'offline', secondsAgo } : { kind: 'seen', secondsAgo };
  }
  // Ни одного запроса, а следим уже дольше порога — молчит; иначе данных пока нет.
  return nowMs - heartbeat.trackedSince.getTime() > DISPATCHER_OFFLINE_AFTER_MS ? { kind: 'offline', secondsAgo: null } : { kind: 'unknown' };
}

// «1:42» — обратный отсчёт до повтора; прошедший момент — «0:00».
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// «повтор через 1:42, попытка 2 из 3». Строка этапа с проваленной попыткой и retryAt
// называет СЛЕДУЮЩУЮ попытку; в остальных случаях — текущую.
export function retryCaption(
  stage: {
    readonly status: string; readonly attempt: number | null; readonly maxAttempts: number | null;
    readonly retryAt: Date | null; readonly queuePosition?: number | null; readonly runMode?: 'quick' | 'full' | null;
  },
  now: Date,
): string | null {
  const parts: string[] = [];
  if (stage.runMode) parts.push(`режим: ${RUN_MODE_META[stage.runMode].label}`);
  if (stage.queuePosition && stage.status === 'started') parts.push(`место в очереди: ${stage.queuePosition}`);
  if (stage.retryAt) {
    const left = stage.retryAt.getTime() - now.getTime();
    parts.push(left > 0 ? `повтор через ${formatCountdown(left)}` : 'повторяем…');
  }
  if (stage.attempt) {
    const shown = stage.retryAt && stage.status === 'failed' ? stage.attempt + 1 : stage.attempt;
    parts.push(stage.maxAttempts ? `попытка ${shown} из ${stage.maxAttempts}` : `попытка ${shown}`);
  }
  return parts.length ? parts.join(', ') : null;
}
