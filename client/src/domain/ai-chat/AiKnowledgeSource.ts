// Зеркало серверного типа: что агент просматривал при подготовке ответов диалога.
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

export function knowledgeSourceSubtitle(source: AiKnowledgeSource): string {
  return source.subtitle ?? KIND_SUBTITLES[source.kind];
}
