import { Check, FileText, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AiAffectedEntity } from '@/domain/ai-action/AiAction';

export type AiActionOutcome = 'applied' | 'rejected';

// Сводка ПОСЛЕ решения: список затронутого остаётся в ленте, откат доступен второй
// линией защиты (§2.1 референса).
export function AiActionResultCard({
  outcome,
  title,
  entities,
  undoing,
  canUndo,
  onUndo,
}: {
  outcome: AiActionOutcome;
  title: string;
  entities: readonly AiAffectedEntity[];
  undoing: boolean;
  canUndo: boolean;
  onUndo: () => void;
}): React.ReactElement {
  const rejected = outcome === 'rejected';
  return (
    <section className="not-prose mt-3 overflow-hidden rounded-xl border bg-card" aria-label={title}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        {rejected ? (
          <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-normal leading-5">{rejected ? 'Отклонено' : 'Готово'}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{title}</p>
        </div>
        {!rejected && canUndo && (
          <Button type="button" size="sm" variant="secondary" className="sm:h-7 sm:px-2" disabled={undoing} onClick={onUndo}>
            {undoing ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Отменить
          </Button>
        )}
      </div>
      {entities.length > 0 && (
        <div className="max-h-48 overflow-y-auto border-t px-1.5 py-1.5">
          {entities.map((entity) => (
            <div key={`${entity.actionId}:${entity.entityId}`} className="flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground">
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate">{entity.title}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
