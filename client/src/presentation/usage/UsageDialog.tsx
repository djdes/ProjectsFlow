import { LayoutGrid } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isFree, isPrimeTrial } from '@/domain/usage/Usage';
import { useUsage } from './UsageProvider';
import { useUpgradeDialog } from './UpgradeDialogProvider';
import { UsageWindowBar } from './UsageWindowBar';
import { planNameRu, subscriptionExpiryNote } from './usageFormat';

// Окно «Использование»: текущий план + расход по окнам (5ч/неделя, %) + переход к тарифам.
export function UsageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): React.ReactElement {
  const { usage, loading } = useUsage();
  const upgrade = useUpgradeDialog();
  const trial = usage ? isPrimeTrial(usage) : false;
  const expiryNote = usage ? subscriptionExpiryNote(usage.plan, usage.subscription.expiresAt) : null;

  // Закрываем это окно ПЕРЕД открытием тарифов — иначе два focus-trap Radix стекаются.
  const openUpgrade = (): void => {
    onOpenChange(false);
    upgrade.open();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Лимиты</DialogTitle>
        </DialogHeader>
        {loading || !usage ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Загрузка…</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Ваш план</span>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">
                {planNameRu(usage.plan)}
              </span>
              {trial && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                  пробный час
                </span>
              )}
            </div>
            {expiryNote && <p className="-mt-3 text-xs text-muted-foreground">{expiryNote}</p>}

            {isFree(usage.plan) ? (
              <p className="text-sm text-muted-foreground">
                На бесплатном тарифе диспетчер недоступен. Оформите Прайм или ВИП, чтобы отдавать
                задачи воркеру и пользоваться AI.
              </p>
            ) : (
              <div className="space-y-4">
                <UsageWindowBar window={usage.fiveHour} rubPerUsd={usage.rubPerUsd} />
                <UsageWindowBar window={usage.sevenDay} rubPerUsd={usage.rubPerUsd} />
              </div>
            )}

            {usage.isBlocked && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Лимит исчерпан — новые задачи приостановлены до сброса окна.
              </div>
            )}

            <Button variant="outline" className="w-full" onClick={openUpgrade}>
              <LayoutGrid className="size-4" /> Другие планы
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
