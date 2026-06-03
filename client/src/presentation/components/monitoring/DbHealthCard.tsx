import type { DbHealth } from '@/domain/monitoring/Snapshot';
import { fmtBytes, fmtDuration } from './format';

// Метрики БД (MariaDB): соединения, размер, аптайм, slow queries.
export function DbHealthCard({ db }: { db: DbHealth }): React.ReactElement {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <h4 className="mb-2 text-sm font-medium">База данных{db.version ? ` · ${db.version}` : ''}</h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <div className="text-muted-foreground">Соединения</div>
          <div className="font-medium tabular-nums">
            {db.connections ?? '—'}
            {db.maxConnections ? ` / ${db.maxConnections}` : ''}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Размер</div>
          <div className="font-medium tabular-nums">{fmtBytes(db.sizeBytes)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Аптайм</div>
          <div className="font-medium tabular-nums">
            {db.uptimeSeconds ? fmtDuration(db.uptimeSeconds * 1000) : '—'}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Slow queries</div>
          <div className="font-medium tabular-nums">{db.slowQueries ?? '—'}</div>
        </div>
      </div>
    </div>
  );
}
