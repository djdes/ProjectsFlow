/**
 * Шаг работы агента. Приезжает в `metadata` ассистентского сообщения — тела ответа
 * не касается, поэтому порядок разбора body (вложения → план действий → markdown)
 * остаётся прежним.
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

const KINDS = new Set<string>(['thought', 'query', 'read', 'write', 'review']);

// Запасные подписи на случай, если сервер прислал шаг без label (старая запись
// metadata). В норме ярлык формируется на сервере.
const FALLBACK_LABELS: Record<AiAgentStepKind, string> = {
  thought: 'Размышление',
  query: 'Запрос к базе',
  read: 'Изучение данных',
  write: 'Изменение данных',
  review: 'Требуется подтверждение',
};

/**
 * Достать шаги из metadata сообщения. Всё непонятное молча отбрасывается: сообщения
 * без шагов (а это все старые) обязаны выглядеть ровно как раньше.
 */
export function readAiAgentSteps(metadata: unknown): AiAgentStep[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = (metadata as Record<string, unknown>)['steps'];
  if (!Array.isArray(raw)) return [];
  const steps: AiAgentStep[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Record<string, unknown>;
    const kind = step['kind'];
    if (typeof kind !== 'string' || !KINDS.has(kind)) continue;
    const typedKind = kind as AiAgentStepKind;
    const label = typeof step['label'] === 'string' && step['label'].trim()
      ? step['label'].trim()
      : FALLBACK_LABELS[typedKind];
    steps.push({
      id: typeof step['id'] === 'string' && step['id'] ? step['id'] : `step-${index + 1}`,
      kind: typedKind,
      label,
      detail: typeof step['detail'] === 'string' && step['detail'].trim() ? step['detail'].trim() : null,
      startedAt: typeof step['startedAt'] === 'string' ? step['startedAt'] : null,
      durationMs: typeof step['durationMs'] === 'number' ? step['durationMs'] : null,
    });
  }
  return steps;
}

export function pluralizeSteps(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'шагов';
  const mod10 = count % 10;
  if (mod10 === 1) return 'шаг';
  if (mod10 >= 2 && mod10 <= 4) return 'шага';
  return 'шагов';
}
