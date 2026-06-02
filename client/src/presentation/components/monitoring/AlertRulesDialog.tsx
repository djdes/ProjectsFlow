import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useContainer } from '@/infrastructure/di/container';
import type { AlertRule, AlertRuleKind } from '@/domain/monitoring/Alert';

const RULE_META: Record<AlertRuleKind, { label: string; unit?: string; hasThreshold: boolean }> = {
  process_down: { label: 'Процесс pm2 не online / сервер недоступен', hasThreshold: false },
  disk_usage: { label: 'Диск заполнен выше порога', unit: '%', hasThreshold: true },
  restart_spike: { label: 'Всплеск рестартов pm2 (прирост за снимок)', unit: 'раз', hasThreshold: true },
  snapshot_stale: { label: 'Нет свежих метрик дольше', unit: 'мин', hasThreshold: true },
  http_down: { label: 'HTTP/uptime-проверка не прошла', hasThreshold: false },
  ssl_expiry: { label: 'SSL-сертификат истекает (осталось ≤)', unit: 'дн', hasThreshold: true },
};

const ORDER: AlertRuleKind[] = [
  'process_down',
  'http_down',
  'disk_usage',
  'restart_spike',
  'ssl_expiry',
  'snapshot_stale',
];

export function AlertRulesDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRules(null);
    monitoringRepository
      .getAlertRules(projectId)
      .then((r) => {
        if (!cancelled) setRules(r);
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, monitoringRepository]);

  const update = (kind: AlertRuleKind, patch: Partial<AlertRule>): void => {
    setRules((prev) => prev?.map((r) => (r.ruleKind === kind ? { ...r, ...patch } : r)) ?? null);
  };

  const save = async (): Promise<void> => {
    if (!rules) return;
    setBusy(true);
    try {
      const saved = await monitoringRepository.saveAlertRules(projectId, rules);
      setRules(saved);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const sorted = rules ? [...rules].sort((a, b) => ORDER.indexOf(a.ruleKind) - ORDER.indexOf(b.ruleKind)) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Настройки алертов</DialogTitle>
          <DialogDescription>
            Пороги и включение правил для серверов этого проекта. Применяются ко всем серверам.
          </DialogDescription>
        </DialogHeader>

        {rules === null ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Загрузка…</div>
        ) : (
          <div className="space-y-3">
            {sorted.map((r) => {
              const meta = RULE_META[r.ruleKind];
              return (
                <div key={r.ruleKind} className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                  <Switch checked={r.enabled} onCheckedChange={(v) => update(r.ruleKind, { enabled: v })} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{meta.label}</p>
                  </div>
                  {meta.hasThreshold && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={r.threshold ?? ''}
                        onChange={(e) =>
                          update(r.ruleKind, {
                            threshold: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        disabled={!r.enabled}
                        className="h-8 w-20 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">{meta.unit}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={busy || rules === null}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
