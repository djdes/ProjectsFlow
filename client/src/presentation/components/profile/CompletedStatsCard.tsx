import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useContainer } from '@/infrastructure/di/container';
import type { WorkspaceCompletedStats } from '@/application/stats/StatsRepository';

// Статистика выполненных задач по пространствам. Две колонки, а не одна «итоговая» цифра:
// честного единого числа тут нет. «Всего» — снимок досок (задачи в «Готово», где я
// ответственный): его могли закрыть и не мои руки. «За 30 дней» — то, что закрыл именно я,
// но глубже журнал активности не хранится (чистится по TTL). Сложить их в одно значило бы
// соврать в обе стороны сразу, поэтому у каждой цифры своя подпись.
export function CompletedStatsCard(): React.ReactElement {
  const { statsRepository } = useContainer();
  const [rows, setRows] = useState<WorkspaceCompletedStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    statsRepository
      .completedByWorkspace()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [statsRepository]);

  const totalDone = (rows ?? []).reduce((sum, r) => sum + r.doneTotal, 0);
  const totalRecent = (rows ?? []).reduce((sum, r) => sum + r.completedRecent, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Выполненные задачи</CardTitle>
        <CardDescription>
          По пространствам, где вы участник. «Всего» — задачи в&nbsp;«Готово», за которые
          отвечаете вы; «За&nbsp;30 дней» — те, что вы закрыли сами.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error !== null ? (
          <p className="text-sm text-destructive">Не удалось загрузить статистику: {error}</p>
        ) : rows === null ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Считаем…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Пространств пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Пространство</th>
                  <th className="w-20 py-1.5 pr-3 text-right font-medium">Всего</th>
                  <th className="w-24 py-1.5 text-right font-medium">За 30 дней</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.workspaceId} className="border-t">
                    <td className="max-w-[16rem] truncate py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.doneTotal}</td>
                    <td className="py-2 text-right tabular-nums">{row.completedRecent}</td>
                  </tr>
                ))}
                {rows.length > 1 && (
                  <tr className="border-t font-medium">
                    <td className="py-2 pr-3">Итого</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{totalDone}</td>
                    <td className="py-2 text-right tabular-nums">{totalRecent}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
