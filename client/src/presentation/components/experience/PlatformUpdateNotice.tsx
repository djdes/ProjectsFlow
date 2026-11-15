import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { deploymentIsActive, newerDeploymentAvailable, type DeploymentPhase, type DeploymentStatus } from '@/domain/deployment/DeploymentStatus';
import { usePlatformDeployment } from '@/presentation/hooks/usePlatformDeployment';

const PHASE: Record<DeploymentPhase, string> = {
  idle: '', queued: 'Ожидаем запуска проверок', checking: 'Проверяем изменения',
  building: 'Собираем новую версию', deploying: 'Устанавливаем новую версию',
  verifying: 'Подтверждаем публикацию', success: 'Новая версия установлена',
  failed: 'Не удалось завершить обновление', canceled: 'Обновление отменено', unknown: 'Проверяем статус',
};

// Hidden notices are remembered per run and stage («progress» while CI runs, «result» after):
// a deployment runs ~10 minutes and shows to everyone on every merge, so a hidden one must not
// come back on the next phase, on a reload or on a PWA relaunch. The result is a new message
// (the reload offer), so hiding the progress does not hide it.
const DISMISSED_KEY = 'pf.platformUpdate.dismissed';
const DISMISSED_LIMIT = 8;
function readDismissed(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}
function rememberDismissed(key: string): readonly string[] {
  const next = [...readDismissed().filter(k => k !== key), key].slice(-DISMISSED_LIMIT);
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* the in-memory list still hides it */ }
  return next;
}

export function DeploymentStatusNotice({ status, browserBuild, observedRun, onReload }: {
  status: DeploymentStatus | null; browserBuild: string; observedRun: string | null; onReload: () => void;
}): React.ReactElement | null {
  const [dismissed, setDismissed] = useState<readonly string[]>(readDismissed);
  const run = status ? `${status.runId}:${status.attempt}` : '';
  const available = !!status && newerDeploymentAvailable(status, browserBuild);
  const active = !!status && deploymentIsActive(status.phase);
  const observed = observedRun === run;
  const uncertain = !!status && status.phase === 'unknown' && observed;
  const failed = !!status && (status.phase === 'failed' || status.phase === 'canceled');
  // A stale status keeps its last phase, so a network blip does not start a new stage.
  const key = `${run}:${active || uncertain ? 'progress' : 'result'}`;
  const dismiss = useCallback((): void => setDismissed(rememberDismissed(key)), [key]);
  // The current version needs no action: confirm briefly. Depends on flags, not on the
  // status object, so a poll every 10s does not restart the timer.
  const autoHide = !!status && !status.stale && status.phase === 'success' && !available && observed;
  useEffect(() => {
    if (!autoHide) return;
    const timer = window.setTimeout(dismiss, 8000);
    return () => window.clearTimeout(timer);
  }, [autoHide, dismiss]);
  const recentFailure = failed && !!status.updatedAt
    && (observed || new Date(status.checkedAt).getTime() - new Date(status.updatedAt).getTime() < 15 * 60_000);
  if (!status || dismissed.includes(key) || (!active && !available && !uncertain && !recentFailure && !(observed && status.phase === 'success'))) return null;
  const confirmed = status.phase === 'success' && !status.stale;
  const title = failed ? 'Обновление не завершено' : active || status.stale || uncertain ? 'Обновление сайта' : 'Сайт обновлён';
  const detail = status.stale ? 'Статус временно недоступен — перепроверяем' : available && !active && !failed ? 'Можно обновить страницу' : PHASE[status.phase];
  const Icon = failed ? TriangleAlert : confirmed ? Check : Sparkles;
  return <div className="pf-platform-update" data-phase={status.phase} data-active={active && !status.stale} role="status" aria-live="polite" aria-atomic="true">
    <span className="pf-platform-update-orbit"><Icon aria-hidden /></span>
    <span className="pf-platform-update-copy"><strong>{title}</strong><span title={detail}>{detail}</span></span>
    {available && <button type="button" className="pf-platform-update-action" onClick={onReload}><RefreshCw aria-hidden />Обновить</button>}
    <button type="button" className="pf-platform-update-close" aria-label="Скрыть статус обновления" title="Скрыть" onClick={dismiss}><X aria-hidden /></button>
    {active && <span className="pf-platform-update-rail" aria-hidden />}
  </div>;
}

export function PlatformUpdateNotice(): React.ReactElement {
  const { status, observedRun } = usePlatformDeployment();
  return <DeploymentStatusNotice status={status} observedRun={observedRun} browserBuild={__PF_BUILD__} onReload={() => window.location.reload()} />;
}
