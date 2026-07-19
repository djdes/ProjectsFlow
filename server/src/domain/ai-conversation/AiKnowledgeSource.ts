/**
 * Источник, который агент просматривал при подготовке ответа. Панель Knowledge —
 * это «что смотрели», в противоположность Artifacts («что сделали»); разделение
 * принципиальное, смешивать их в одну ленту нельзя.
 */
export type AiKnowledgeSourceKind = 'project' | 'task' | 'kb_page' | 'document';

export type AiKnowledgeSource = {
  readonly id: string;
  readonly kind: AiKnowledgeSourceKind;
  readonly title: string;
  readonly subtitle: string | null;
  readonly href: string | null;
};

const KIND_SUBTITLES: Record<AiKnowledgeSourceKind, string> = {
  project: 'Проект',
  task: 'Задача',
  kb_page: 'База знаний',
  document: 'Документ',
};

export function knowledgeSourceSubtitle(kind: AiKnowledgeSourceKind): string {
  return KIND_SUBTITLES[kind];
}

export function isKnowledgeSourceKind(value: unknown): value is AiKnowledgeSourceKind {
  return value === 'project' || value === 'task' || value === 'kb_page' || value === 'document';
}

export const MAX_AI_KNOWLEDGE_SOURCES = 50;

type RawSource = {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly title?: unknown;
  readonly subtitle?: unknown;
  readonly href?: unknown;
};

export function normalizeKnowledgeSources(value: unknown): AiKnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  const sources: AiKnowledgeSource[] = [];
  for (const raw of value) {
    if (sources.length >= MAX_AI_KNOWLEDGE_SOURCES) break;
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as RawSource;
    if (!isKnowledgeSourceKind(source.kind)) continue;
    const id = typeof source.id === 'string' ? source.id.trim().slice(0, 80) : '';
    const title = typeof source.title === 'string' ? source.title.trim().slice(0, 300) : '';
    if (!id || !title) continue;
    const subtitle = typeof source.subtitle === 'string' ? source.subtitle.trim().slice(0, 200) : '';
    sources.push({
      id,
      kind: source.kind,
      title,
      subtitle: subtitle || knowledgeSourceSubtitle(source.kind),
      // Только относительные пути: href приезжает от воркера и уходит в href ссылки,
      // абсолютный URL здесь означал бы открытый редирект на чужой домен.
      href: typeof source.href === 'string' && source.href.startsWith('/')
        ? source.href.trim().slice(0, 300)
        : null,
    });
  }
  return sources;
}

/**
 * Свести источники всех ответов диалога в один список. Один и тот же проект,
 * просмотренный в трёх ответах подряд, должен дать одну строку, а не три.
 */
export function mergeKnowledgeSources(
  batches: readonly (readonly AiKnowledgeSource[])[],
  limit = 200,
): AiKnowledgeSource[] {
  const byKey = new Map<string, AiKnowledgeSource>();
  for (const batch of batches) {
    for (const source of batch) {
      const key = `${source.kind}:${source.id}`;
      if (!byKey.has(key)) byKey.set(key, source);
      if (byKey.size >= limit) return [...byKey.values()];
    }
  }
  return [...byKey.values()];
}
