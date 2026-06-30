import { ArrowUpCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isFree } from '@/domain/usage/Usage';
import { useUsage } from './UsageProvider';
import { useUpgradeDialog } from './UpgradeDialogProvider';
import { UsageWindowBar } from './UsageWindowBar';
import { planNameRu, subscriptionExpiryNote } from './usageFormat';

// Окно «Использование»: два скользящих окна 5ч/неделя + текущий план + CTA «Улучшить».
export function UsageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): React.ReactElement {
  const { usage, loading } = useUsage();
  const upgrade = useUpgradeDialog();
  const expiryNote = usage ? subscriptionExpiryNote(usage.plan, usage.subscription.expiresAt) : null;

  // Закрываем это окно ПЕРЕД открытием апгрейда — иначе два focus-trap Radix стекаются.
  const openUpgrade = (): void => {
    onOpenChange(false);
    upgrade.open();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Использование</DialogTitle>
        </DialogHeader>
        {loading || !usage ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Загрузка…</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Ваш план</span>
              <span className="font-semibold">{planNameRu(usage.plan)}</span>
            </div>
            {expiryNote && <p className="-mt-3 text-xs text-muted-foreground">{expiryNote}</p>}
            {isFree(usage.plan) && (
              <p className="text-sm text-muted-foreground">
                На бесплатном тарифе расход метрится, но лимиты платформы не применяются —
                диспетчер работает на вашей подписке Claude.
              </p>
            )}
            <div className="space-y-4">
              <UsageWindowBar window={usage.fiveHour} rubPerUsd={usage.rubPerUsd} />
              <UsageWindowBar window={usage.sevenDay} rubPerUsd={usage.rubPerUsd} />
            </div>
            {usage.isBlocked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Лимит исчерпан — новые AI-задачи приостановлены до сброса окна.
              </div>
            )}
            {usage.plan !== 'vip' && (
              <Button className="w-full" onClick={openUpgrade}>
                <ArrowUpCircle className="size-4" /> Улучшить план
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
