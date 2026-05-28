import type { Project } from '../../domain/project/Project.js';
import type { ListKbDocuments } from '../kb/ListKbDocuments.js';
import type { GetKbDocument } from '../kb/GetKbDocument.js';

const MAX_DOCS = 12;
const MAX_PER_DOC = 4000;
const MAX_TOTAL = 30_000;

type Deps = {
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
};

/**
 * Собирает компактный текстовый KB-бандл из первых N документов проекта,
 * чтобы передать его в Claude как контекст. Ограничения:
 * - максимум 12 документов;
 * - максимум 4000 символов на документ (хвост обрезается);
 * - максимум 30000 символов суммарно.
 *
 * Если проект без KB или произошла ошибка получения списка — возвращает null
 * (best-effort: AI всё равно сработает, просто без KB-контекста).
 */
export async function prepareKbContext(
  project: Project,
  userId: string,
  deps: Deps,
): Promise<string | null> {
  if (project.kbKind === 'none') return null;

  let summaries;
  try {
    summaries = await deps.listKbDocuments.execute(project.id, userId);
  } catch {
    return null;
  }
  if (summaries.length === 0) return null;

  const top = summaries.slice(0, MAX_DOCS);
  const parts: string[] = [];
  let total = 0;

  for (const summary of top) {
    if (total >= MAX_TOTAL) break;
    let body: string;
    let title: string;
    try {
      const doc = await deps.getKbDocument.execute(project.id, userId, summary.path);
      const fmTitle = doc.frontmatter['title'];
      title = typeof fmTitle === 'string' && fmTitle.length > 0 ? fmTitle : summary.path;
      body = doc.body;
    } catch {
      continue;
    }

    if (body.length > MAX_PER_DOC) {
      body = body.slice(0, MAX_PER_DOC) + '\n…(truncated)';
    }

    const part = `## ${title} (${summary.path})\n\n${body}`;
    if (total + part.length > MAX_TOTAL) {
      parts.push(part.slice(0, MAX_TOTAL - total) + '\n…(truncated)');
      break;
    }
    parts.push(part);
    total += part.length;
  }

  return parts.length === 0 ? null : parts.join('\n\n---\n\n');
}
