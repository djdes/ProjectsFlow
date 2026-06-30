import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { PLAN_CATALOG } from '@/domain/usage/PlanCatalog';
import { PLAN_ORDER, type PlanId } from '@/domain/usage/Usage';
import { useUsage } from './UsageProvider';
import { planNameRu } from './usageFormat';

// Сравнительная таблица тарифов (à la Notion). Текущий план выделен, кнопка disabled.
// «Выбрать» → changePlan (реального биллинга пока нет) → applyUsage свежей сводкой.
export function UpgradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): React.ReactElement {
  const { changePlan } = useContainer();
  const { usage, applyUsage } = useUsage();
  const currentPlan: PlanId = usage?.subscription.plan ?? 'free';
  const [pending, setPending] = useState<PlanId | null>(null);

  const choose = async (plan: PlanId): Promise<void> => {
    if (plan === currentPlan || pending) return;
    setPending(plan);
    try {
      const next = await changePlan.execute(plan);
      applyUsage(next);
      toast.success(plan === 'free' ? 'Подписка отменена' : `Тариф изменён: ${planNameRu(plan)}`);
      onOpenChange(false);
    } catch {
      toast.error('Не удалось сменить тариф');
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Выберите план</DialogTitle>
          <DialogDescription>Оплата подключается позже — план переключится сразу.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {PLAN_CATALOG.map((p) => {
            const isCurrent = p.id === currentPlan;
            const isUpgrade = PLAN_ORDER[p.id] > PLAN_ORDER[currentPlan];
            return (
              <div
                key={p.id}
                className={cn(
                  'flex flex-col rounded-lg border p-4',
                  isCurrent ? 'border-primary ring-2 ring-primary/40' : 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{p.nameRu}</span>
                  {isCurrent && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Текущий
                    </span>
                  )}
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums">
                  {p.priceRub == null ? (
                    'Бесплатно'
                  ) : (
                    <>
                      {p.priceRub.toLocaleString('ru-RU')} ₽
                      <span className="text-sm font-normal text-muted-foreground">/мес</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.tagline}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  variant={isCurrent ? 'outline' : isUpgrade ? 'default' : 'secondary'}
                  disabled={isCurrent || pending !== null}
                  onClick={() => void choose(p.id)}
                >
                  {pending === p.id && <Loader2 className="size-4 animate-spin" />}
                  {isCurrent ? 'Текущий план' : isUpgrade ? 'Выбрать' : 'Перейти'}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
