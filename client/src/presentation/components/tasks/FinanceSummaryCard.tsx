import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatRub } from '@/lib/money';
import type { ProjectFinance } from '@/domain/finance/types';
import { useContainer } from '@/infrastructure/di/container';

// Компактная сводка P&L на доске (вместо бывшего пайплайна). Сама гейтится: если
// финансы не видны текущему юзеру — сервер вернёт 403/404 и карточка не рендерится.
export function FinanceSummaryCard({ projectId }: { projectId: string }): React.ReactElement | null {
  const { projectFinanceRepository } = useContainer();
  const [finance, setFinance] = useState<ProjectFinance | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHidden(false);
    setFinance(null);
    projectFinanceRepository
      .getSummary(projectId)
      .then((f) => {
        if (!cancelled) setFinance(f);
      })
      .catch(() => {
        if (!cancelled) setHidden(true); // нет доступа к финансам — просто не показываем
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectFinanceRepository]);

  if (hidden) return null;
  if (!finance) return null;

  const profitPositive = finance.profitKopecks >= 0;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <Wallet className="size-3.5" /> Финансы
          </p>
          <Link
            to={`/projects/${projectId}/finance`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Подробнее <ArrowRight className="size-3" />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Metric label="Доход" value={formatRub(finance.incomeTotalKopecks)} />
          <Metric label="Расход" value={formatRub(finance.expenseTotalKopecks)} />
          <Metric
            label="Прибыль"
            value={formatRub(finance.profitKopecks)}
            valueClass={profitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}
            hint={
              finance.marginPercent === null ? undefined : `маржа ${finance.marginPercent}%`
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('truncate font-mono text-lg font-semibold tabular-nums', valueClass)}>{value}</p>
      {hint && <p className="truncate text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
