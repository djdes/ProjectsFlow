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
import { HttpError } from '@/lib/HttpError';
import { PLAN_CATALOG } from '@/domain/usage/PlanCatalog';
import type { PlanId } from '@/domain/usage/Usage';
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
  // Эффективный план (истёкший prime/vip уже трактуется как free).
  const currentPlan: PlanId = usage?.plan ?? 'free';
  const [pending, setPending] = useState<PlanId | null>(null);

  const choose = async (plan: PlanId): Promise<void> => {
    if (plan === currentPlan || pending) return;
    setPending(plan);
    try {
      const next = await changePlan.execute(plan);
      applyUsage(next);
      toast.success(
        plan === 'free'
          ? 'Переключено на Бесплатный'
          : plan === 'prime'
            ? 'Прайм активирован на 1 час'
            : `Тариф изменён: ${planNameRu(plan)}`,
      );
      onOpenChange(false);
    } catch (e) {
      // 409 (триал использован) / 403 (ВИП по запросу) — показываем серверное сообщение.
      toast.error(e instanceof HttpError ? (e.body.message ?? 'Не удалось сменить тариф') : 'Не удалось сменить тариф');
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
            const trialAvailable = usage?.primeTrialAvailable ?? false;
            // Платный план активен (Прайм/ВИП) — на Бесплатный система перейдёт САМА по
            // истечении срока. Ручной даунгрейд блокируем, чтобы не потерять оплаченное/триал.
            const paidActive = currentPlan !== 'free';
            // VIP — только по запросу (не self-serve); Прайм — разовый пробный час;
            // Бесплатный — заблокирован, пока активен платный план.
            const locked =
              !isCurrent &&
              (p.id === 'vip' ||
                (p.id === 'prime' && !trialAvailable) ||
                (p.id === 'free' && paidActive));
            const label = isCurrent
              ? 'Текущий план'
              : p.id === 'vip'
                ? 'По запросу'
                : p.id === 'prime'
                  ? trialAvailable
                    ? 'Попробовать 1 час'
                    : 'Триал использован'
                  : paidActive
                    ? `${planNameRu(currentPlan)} активен`
                    : 'Перейти на бесплатный';
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
                  variant={!isCurrent && p.id === 'prime' && trialAvailable ? 'default' : 'outline'}
                  disabled={isCurrent || locked || pending !== null}
                  onClick={() => void choose(p.id)}
                  title={
                    p.id === 'vip' && !isCurrent
                      ? 'Подключается по запросу через поддержку'
                      : p.id === 'free' && paidActive
                        ? `${planNameRu(currentPlan)} активен — на Бесплатный переключится автоматически по истечении срока`
                        : undefined
                  }
                >
                  {pending === p.id && <Loader2 className="size-4 animate-spin" />}
                  {label}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
