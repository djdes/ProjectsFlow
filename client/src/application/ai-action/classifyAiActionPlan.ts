import type { AiAction, AiActionPlan, AiActionRisk } from '@/domain/ai-action/AiAction';
import { aiActionRisk } from '@/domain/ai-action/AiAction';

export type AiActionPlanClassification = {
  // Риск плана целиком: 'destructive', если хотя бы одно действие разрушительное.
  readonly risk: AiActionRisk;
  // Исполняются сразу, без подтверждения (чтение и созидание).
  readonly autoActions: readonly AiAction[];
  // Требуют явного review со списком затрагиваемых объектов.
  readonly reviewActions: readonly AiAction[];
  readonly requiresReview: boolean;
};

/**
 * Делит план на две стадии по риску. Относительный порядок действий внутри каждой
 * стадии сохраняется: `create_project` обязан выполниться раньше зависимых от него
 * `create_task` (резолв projectRef), а разрушительные — не раньше, чем пользователь
 * их подтвердит.
 */
export function classifyAiActionPlan(plan: AiActionPlan): AiActionPlanClassification {
  const autoActions: AiAction[] = [];
  const reviewActions: AiAction[] = [];
  for (const action of plan.actions) {
    if (aiActionRisk(action) === 'destructive') reviewActions.push(action);
    else autoActions.push(action);
  }
  return {
    risk: reviewActions.length > 0 ? 'destructive' : 'safe',
    autoActions,
    reviewActions,
    requiresReview: reviewActions.length > 0,
  };
}
