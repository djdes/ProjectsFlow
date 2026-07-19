/**
 * Один шаг работы агента над ответом. Хранится в `metadata_json` ассистентского
 * сообщения (миграция не нужна, колонка есть с db/132) и рендерится сворачиваемым
 * блоком «N шагов» над телом ответа.
 */
export type AiAgentStepKind = 'thought' | 'query' | 'read' | 'write' | 'review';

export type AiAgentStep = {
  readonly id: string;
  readonly kind: AiAgentStepKind;
  readonly label: string;
  readonly detail: string | null;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
};

export const AI_AGENT_STEP_KINDS: readonly AiAgentStepKind[] = [
  'thought',
  'query',
  'read',
  'write',
  'review',
];

// Ярлык формируется здесь, а не в UI: воркер шлёт технический вид шага, и если бы
// подпись приезжала от него, в ленте оказались бы имена tool-call'ов вперемешку
// с языками. Свободный текст воркера уходит в detail.
const STEP_LABELS: Record<AiAgentStepKind, string> = {
  thought: 'Размышление',
  query: 'Запрос к базе',
  read: 'Изучение данных',
  write: 'Изменение данных',
  review: 'Требуется подтверждение',
};

export function agentStepLabel(kind: AiAgentStepKind): string {
  return STEP_LABELS[kind];
}

export function isAgentStepKind(value: unknown): value is AiAgentStepKind {
  return typeof value === 'string' && (AI_AGENT_STEP_KINDS as readonly string[]).includes(value);
}

export const MAX_AI_AGENT_STEPS = 50;

type RawStep = {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly detail?: unknown;
  readonly startedAt?: unknown;
  readonly durationMs?: unknown;
};

/**
 * Привести шаги воркера к домену. Неизвестный вид шага не роняет весь ответ — он
 * отбрасывается: ответ пользователю важнее полноты телеметрии.
 */
export function normalizeAgentSteps(value: unknown): AiAgentStep[] {
  if (!Array.isArray(value)) return [];
  const steps: AiAgentStep[] = [];
  for (const [index, raw] of value.entries()) {
    if (steps.length >= MAX_AI_AGENT_STEPS) break;
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as RawStep;
    if (!isAgentStepKind(step.kind)) continue;
    const detail = typeof step.detail === 'string' ? step.detail.trim().slice(0, 2_000) : '';
    steps.push({
      id: typeof step.id === 'string' && step.id.trim()
        ? step.id.trim().slice(0, 80)
        : `step-${index + 1}`,
      kind: step.kind,
      label: agentStepLabel(step.kind),
      detail: detail || null,
      startedAt: typeof step.startedAt === 'string' && step.startedAt.trim()
        ? step.startedAt.trim().slice(0, 40)
        : null,
      durationMs: typeof step.durationMs === 'number' && Number.isFinite(step.durationMs)
        ? Math.max(0, Math.trunc(step.durationMs))
        : null,
    });
  }
  return steps;
}
