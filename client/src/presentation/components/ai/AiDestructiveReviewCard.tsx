import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AiAffectedEntity } from '@/domain/ai-action/AiAction';

// Карточка review разрушительной операции: inline в ленте, НЕ модалка (§2 референса).
// Список затрагиваемых объектов показывается ДО решения, кнопка удаления — единственная
// цветная в ленте, отмена нейтральная (secondary, не outline).
export function AiDestructiveReviewCard({
  entities,
  loading,
  busy,
  error,
  onReject,
  onConfirm,
}: {
  entities: readonly AiAffectedEntity[];
  loading: boolean;
  busy: boolean;
  error?: string;
  onReject: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const heading = loading
    ? 'Готовлю список задач к удалению…'
    : `Удалить ${entities.length} ${pluralizeTasks(entities.length)}?`;

  return (
    <section className="not-prose mt-3 overflow-hidden rounded-xl border bg-card" aria-label="Требуется подтверждение">
      <div className="flex items-center gap-2 border-b bg-muted/25 px-3 py-2 text-xs font-medium text-muted-foreground">
        <AlertTriangle className="size-3.5 text-destructive" />
        Требуется подтверждение
      </div>
      <div className="px-3 py-2.5">
        <h3 className="text-sm font-normal leading-5">{heading}</h3>
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" className="sm:h-7 sm:px-2" disabled={busy} onClick={onReject}>
            Отклонить
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="sm:h-7 sm:px-2"
            disabled={busy || loading || entities.length === 0}
            onClick={onConfirm}
          >
            {busy && <Loader2 className="animate-spin" />}
            Удалить
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
      <div className="max-h-48 overflow-y-auto border-t px-1.5 py-1.5">
        {loading && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Загружаю задачи…</p>
        )}
        {!loading && entities.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Удалять нечего — задачи уже отсутствуют.</p>
        )}
        {entities.map((entity) => (
          <div key={`${entity.actionId}:${entity.entityId}`} className="flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-xs">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{entity.title}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Русская плюрализация: 1 задачу / 2 задачи / 5 задач.
export function pluralizeTasks(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'задач';
  const last = count % 10;
  if (last === 1) return 'задачу';
  if (last >= 2 && last <= 4) return 'задачи';
  return 'задач';
}
