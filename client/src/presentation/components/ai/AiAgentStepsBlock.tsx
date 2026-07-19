import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible } from '@/components/ui/collapsible';
import type { AiAgentStep } from '@/domain/ai-chat/AiAgentStep';
import { pluralizeSteps } from '@/domain/ai-chat/AiAgentStep';

/**
 * Сворачиваемый блок «N шагов» над телом ответа (референс §3).
 *
 * Ничего не рендерит, когда шагов нет и подтверждение не требуется: сообщения от
 * воркера, который шаги не шлёт (а это все старые), обязаны выглядеть как раньше.
 */
export function AiAgentStepsBlock({
  steps,
  needsReview = false,
}: {
  steps: readonly AiAgentStep[];
  needsReview?: boolean;
}): React.ReactElement | null {
  // «Требуется подтверждение» — не обычный шаг: он идёт последним, вне счётчика,
  // и виден даже когда список свёрнут.
  if (steps.length === 0 && !needsReview) return null;

  return (
    <div className="not-prose mb-2 text-sm leading-5">
      {steps.length > 0 && (
        <Collapsible
          trigger={<span className="text-muted-foreground">{steps.length} {pluralizeSteps(steps.length)}</span>}
          triggerClassName="py-1 text-muted-foreground hover:text-foreground"
        >
          <ul className="ml-[26px] flex flex-col">
            {steps.map((step) => <AgentStepItem key={step.id} step={step} />)}
          </ul>
        </Collapsible>
      )}
      {needsReview && (
        <p className="flex items-center gap-1.5 py-1 text-muted-foreground">
          <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-amber-500" />
          Требуется подтверждение
        </p>
      )}
    </div>
  );
}

// Каждый пункт раскрывается отдельно — как в оригинале, где у шага своя стрелка «›».
function AgentStepItem({ step }: { step: AiAgentStep }): React.ReactElement {
  const label = (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
      <span className="truncate">{step.label}</span>
      {step.durationMs !== null && (
        <span className="shrink-0 text-[11px] tabular-nums opacity-70">
          {formatDuration(step.durationMs)}
        </span>
      )}
    </span>
  );

  if (!step.detail) {
    return (
      <li className={cn('flex min-h-8 items-center gap-1.5 pl-[14px]')}>
        <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-muted-foreground/50" />
        {label}
      </li>
    );
  }

  return (
    <li className="min-h-8">
      <Collapsible
        trigger={label}
        triggerClassName="min-h-8 py-1 hover:text-foreground"
        contentClassName="pb-1.5 pl-[22px] text-xs leading-5 text-muted-foreground"
      >
        {step.detail}
      </Collapsible>
    </li>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} мс`;
  return `${(durationMs / 1_000).toFixed(1)} с`;
}
