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
import { isPrimeTrial, type PlanId } from '@/domain/usage/Usage';
import { useUsage } from './UsageProvider';
import { planNameRu, subscriptionExpiryNote } from './usageFormat';

// Кумулятивная витрина: Прайм = «Всё из Бесплатного» +, VIP = «Всё из Прайма» +.
const PREV_NAME: Partial<Record<PlanId, string>> = { prime: 'Бесплатного', vip: 'Прайма' };

type Action = {
  key: string;
  label: string;
  variant: 'default' | 'outline';
  disabled: boolean;
  onClick?: () => void;
};

// Окно «Улучшить план» (из меню аккаунта): текущий план + сравнение всех тарифов + умные кнопки.
export function UpgradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): React.ReactElement {
  const { changePlan } = useContainer();
  const { usage, applyUsage } = useUsage();
  const [pending, setPending] = useState(false);

  const currentPlan: PlanId = usage?.plan ?? 'free';
  const trial = usage ? isPrimeTrial(usage) : false;
  const trialAvailable = usage?.primeTrialAvailable ?? false;
  const expiryNote = usage ? subscriptionExpiryNote(usage.plan, usage.subscription.expiresAt) : null;

  // Пробный час Прайма — единственное self-serve действие.
  const activateTrial = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      applyUsage(await changePlan.execute('prime'));
      toast.success('Прайм активирован на 1 час');
    } catch (e) {
      toast.error(e instanceof HttpError ? (e.body.message ?? 'Не удалось активировать') : 'Не удалось активировать');
    } finally {
      setPending(false);
    }
  };

  // Полный тариф — по запросу (не self-serve): направляем в поддержку.
  const requestUpgrade = (plan: PlanId): void => {
    toast(`Тариф «${planNameRu(plan)}» подключается по запросу — напишите нам в поддержку (кнопка справа снизу).`);
  };

  function actionsFor(planId: PlanId): Action[] {
    if (planId === 'free') return []; // у бесплатного кнопки нет вообще
    if (planId === 'prime') {
      if (currentPlan === 'vip') return []; // Прайм ниже ВИП — кнопки нет
      if (currentPlan === 'prime') {
        return trial
          ? [
              { key: 'up', label: 'Улучшить', variant: 'default', disabled: pending, onClick: () => requestUpgrade('prime') },
              { key: 'trial', label: 'Уже улучшено на 1 час', variant: 'outline', disabled: true },
            ]
          : [{ key: 'cur', label: 'Уже улучшено', variant: 'outline', disabled: true }];
      }
      const acts: Action[] = [
        { key: 'up', label: 'Улучшить', variant: 'default', disabled: pending, onClick: () => requestUpgrade('prime') },
      ];
      if (trialAvailable) {
        acts.push({ key: 'trial', label: 'Попробовать 1 час', variant: 'outline', disabled: pending, onClick: () => void activateTrial() });
      }
      return acts;
    }
    if (currentPlan === 'vip') return [{ key: 'cur', label: 'Уже улучшено', variant: 'outline', disabled: true }];
    return [{ key: 'up', label: 'Улучшить', variant: 'default', disabled: pending, onClick: () => requestUpgrade('vip') }];
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Тарифы</DialogTitle>
          <DialogDescription>
            Ваш план:{' '}
            <span className="font-medium text-foreground">{planNameRu(currentPlan)}</span>
            {trial && ' (пробный час)'}
            {expiryNote ? ` · ${expiryNote}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          {PLAN_CATALOG.map((p) => {
            const isCurrent = p.id === currentPlan;
            const actions = actionsFor(p.id);
            const prev = PREV_NAME[p.id];
            return (
              <div
                key={p.id}
                className={cn(
                  'flex flex-col rounded-2xl border p-4 transition-colors',
                  isCurrent ? 'border-primary bg-primary/[0.03] ring-1 ring-primary/30' : 'border-border bg-card',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{p.nameRu}</span>
                  {isCurrent && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Ваш план
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
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{p.tagline}</p>

                <ul className="mt-3 flex-1 space-y-1.5 text-[13px]">
                  {prev && (
                    <li className="flex gap-2 font-medium text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>Всё из «{prev}»</span>
                    </li>
                  )}
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2 text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary/70" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {actions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {actions.map((a) => (
                      <Button key={a.key} className="w-full" variant={a.variant} disabled={a.disabled} onClick={a.onClick}>
                        {pending && a.key === 'trial' && a.onClick && <Loader2 className="size-4 animate-spin" />}
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
