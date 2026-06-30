import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUsage } from '@/presentation/usage/UsageProvider';
import { useUsageDialog } from '@/presentation/usage/UsageDialogProvider';
import { useUpgradeDialog } from '@/presentation/usage/UpgradeDialogProvider';
import { UsageWindowBar } from '@/presentation/usage/UsageWindowBar';
import { planNameRu } from '@/presentation/usage/usageFormat';

// Карточка профиля: тариф + два окна расхода + кнопки «Подробнее»/«Улучшить план».
export function PlanAndUsageCard(): React.ReactElement {
  const { usage, loading } = useUsage();
  const usageDialog = useUsageDialog();
  const upgrade = useUpgradeDialog();

  return (
    <Card>
      <CardHeader>
        <CardTitle>План и использование</CardTitle>
        <CardDescription>Текущий тариф и расход AI по двум окнам (5 часов / неделя).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !usage ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Тариф</span>
              <span className="text-sm font-semibold">{planNameRu(usage.subscription.plan)}</span>
            </div>
            <UsageWindowBar window={usage.fiveHour} rubPerUsd={usage.rubPerUsd} />
            <UsageWindowBar window={usage.sevenDay} rubPerUsd={usage.rubPerUsd} />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => usageDialog.open()}>
                Подробнее
              </Button>
              {usage.subscription.plan !== 'vip' && (
                <Button size="sm" onClick={() => upgrade.open()}>
                  {usage.subscription.plan === 'free' ? 'Подключить план' : 'Улучшить план'}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
