import type { ListProjects } from '../project/ListProjects.js';
import type { ListKbDocuments } from '../kb/ListKbDocuments.js';
import type { GetKbDocument } from '../kb/GetKbDocument.js';
import { prepareKbContext } from './prepareKbContext.js';

// Сколько проектов-кандидатов максимум кладём в контекст compose-job'а и общий потолок.
const MAX_PROJECTS = 40;
const MAX_TOTAL_CHARS = 60_000;
// Короткий дайджест на проект: 1-2 верхних документа KB, ~800 симв. каждый, ~1800 итог.
const DIGEST_LIMITS = { maxDocs: 2, maxPerDoc: 800, maxTotal: 1800 } as const;

type Deps = {
  readonly listProjects: ListProjects;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
};

export type ComposeCandidate = {
  readonly projectId: string;
  readonly name: string;
};

export type ComposeContext = {
  // Текстовый блок для промпта pass-1 (классификация + «Простой»).
  readonly block: string;
  // Список кандидатов (id+name) — на будущее / для отладки.
  readonly candidates: ComposeCandidate[];
};

/**
 * Готовит контекст для compose-режима: перечень проектов, в которых пользователь
 * МОЖЕТ создавать задачи (роль editor/owner, не Inbox), с коротким KB-дайджестом
 * каждого. Этот блок кладётся в kb_context job'а; ralph отдаёт его модели в pass-1,
 * чтобы та разбила текст на задачи и классифицировала каждую к нужному проекту.
 *
 * Best-effort: ошибки KB на отдельном проекте не валят сборку (проект попадает в
 * список без дайджеста). Если проектов-кандидатов нет — возвращает null.
 */
export async function prepareComposeContext(
  userId: string,
  deps: Deps,
): Promise<ComposeContext | null> {
  let projects;
  try {
    projects = await deps.listProjects.execute(userId);
  } catch {
    return null;
  }

  const creatable = projects
    .filter((p) => (p.role === 'editor' || p.role === 'owner') && !p.isInbox)
    .slice(0, MAX_PROJECTS);
  if (creatable.length === 0) return null;

  // Дайджесты собираем параллельно (best-effort на каждый проект).
  const digests = await Promise.all(
    creatable.map(async (p) => {
      let digest: string | null = null;
      try {
        digest = await prepareKbContext(p, userId, deps, DIGEST_LIMITS);
      } catch {
        digest = null;
      }
      return { projectId: p.id, name: p.name, digest };
    }),
  );

  const candidates: ComposeCandidate[] = digests.map((d) => ({
    projectId: d.projectId,
    name: d.name,
  }));

  const parts: string[] = [];
  let total = 0;
  for (const d of digests) {
    const body = d.digest && d.digest.trim().length > 0 ? d.digest.trim() : '(KB не подключена)';
    const part = `[projectId=${d.projectId}] ${d.name}\n${body}`;
    if (total + part.length > MAX_TOTAL_CHARS) {
      // Дальше не лезем, но сам проект (хотя бы строкой имени) всё равно полезен —
      // добавим усечённый заголовок без дайджеста, чтобы id остался доступен модели.
      const header = `[projectId=${d.projectId}] ${d.name}\n(дайджест опущен — лимит контекста)`;
      if (total + header.length <= MAX_TOTAL_CHARS) {
        parts.push(header);
        total += header.length;
      }
      continue;
    }
    parts.push(part);
    total += part.length;
  }

  const block = parts.join('\n\n---\n\n');
  return { block, candidates };
}
