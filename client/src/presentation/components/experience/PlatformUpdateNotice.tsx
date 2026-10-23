import { useEffect, useState } from 'react';
import { Check, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { deploymentIsActive, newerDeploymentAvailable, type DeploymentPhase, type DeploymentStatus } from '@/domain/deployment/DeploymentStatus';
import { usePlatformDeployment } from '@/presentation/hooks/usePlatformDeployment';

const PHASE: Record<DeploymentPhase, string> = {
  idle: '', queued: 'Ожидаем запуска проверок', checking: 'Проверяем изменения',
  building: 'Собираем новую версию', deploying: 'Устанавливаем новую версию',
  verifying: 'Подтверждаем публикацию', success: 'Новая версия установлена',
  failed: 'Не удалось завершить обновление', canceled: 'Обновление отменено', unknown: 'Проверяем статус',
};

export function DeploymentStatusNotice({ status, browserBuild, observedRun, onReload }: {
  status: DeploymentStatus | null; browserBuild: string; observedRun: string | null; onReload: () => void;
}): React.ReactElement | null {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = status ? `${status.runId}:${status.attempt}` : '';
  const available = !!status && newerDeploymentAvailable(status, browserBuild);
  const active = !!status && deploymentIsActive(status.phase);
  const observed = observedRun === key;
  const uncertain = !!status && status.phase === 'unknown' && observed;
  useEffect(() => {
    if (!status || status.stale || status.phase !== 'success' || available || !observed) return;
    const timer = window.setTimeout(() => setDismissed(key), 8000);
    return () => window.clearTimeout(timer);
  }, [status, key, available, observed]);
  const recentFailure = !!status && ['failed', 'canceled'].includes(status.phase) && !!status.updatedAt
    && (observed || new Date(status.checkedAt).getTime() - new Date(status.updatedAt).getTime() < 15 * 60_000);
  if (!status || dismissed === key || (!active && !available && !uncertain && !recentFailure && !(observed && status.phase === 'success'))) return null;
  const failed = status.phase === 'failed' || status.phase === 'canceled';
  const confirmed = status.phase === 'success' && !status.stale;
  const title = failed ? 'Обновление не завершено' : active || status.stale || uncertain ? 'Обновление сайта' : 'Сайт обновлён';
  const detail = status.stale ? 'Статус временно недоступен — перепроверяем' : available && !active && !failed ? 'Можно обновить страницу' : PHASE[status.phase];
  const Icon = failed ? TriangleAlert : confirmed ? Check : Sparkles;
  return <div className="pf-platform-update" data-phase={status.phase} data-active={active && !status.stale} role="status" aria-live="polite" aria-atomic="true">
    <span className="pf-platform-update-orbit"><Icon aria-hidden /></span>
    <span className="pf-platform-update-copy"><strong>{title}</strong><span title={detail}>{detail}</span></span>
    {available && <button type="button" className="pf-platform-update-action" onClick={onReload}><RefreshCw aria-hidden />Обновить</button>}
    {!active && <button type="button" className="pf-platform-update-close" aria-label="Скрыть статус обновления" onClick={() => setDismissed(key)}><X aria-hidden /></button>}
    {active && <span className="pf-platform-update-rail" aria-hidden />}
  </div>;
}

export function PlatformUpdateNotice(): React.ReactElement {
  const { status, observedRun } = usePlatformDeployment();
  return <DeploymentStatusNotice status={status} observedRun={observedRun} browserBuild={__PF_BUILD__} onReload={() => window.location.reload()} />;
}
