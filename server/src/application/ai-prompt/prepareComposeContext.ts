import type { ListProjects } from '../project/ListProjects.js';
import type { ListKbDocuments } from '../kb/ListKbDocuments.js';
import type { GetKbDocument } from '../kb/GetKbDocument.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { prepareKbContext } from './prepareKbContext.js';

// Сколько проектов-кандидатов максимум кладём в контекст compose-job'а и общий потолок.
const MAX_PROJECTS = 40;
const MAX_TOTAL_CHARS = 60_000;
// Короткий дайджест на проект: 1-2 верхних документа KB, ~800 симв. каждый, ~1800 итог.
const DIGEST_LIMITS = { maxDocs: 2, maxPerDoc: 800, maxTotal: 1800 } as const;
// Сколько участников максимум перечисляем на проект (варианты ответственного).
const MAX_MEMBERS_PER_PROJECT = 20;
// Отдельный потолок на ВСЕ строки участников: чтобы большие команды не вытесняли
// KB-дайджесты из общего бюджета (они важнее для классификации проекта).
const MAX_MEMBER_TOTAL_CHARS = 15_000;

type Deps = {
  readonly listProjects: ListProjects;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
  readonly members: ProjectMemberRepository;
};

// Сегодняшняя дата в формате YYYY-MM-DD. Нужна модели, чтобы резолвить относительные
// сроки («на сегодня», «до конца недели»). Считаем в фиксированной зоне продукта
// (пользователи в РФ): UTC-сервер около полуночи иначе даёт «сегодня» на день вперёд.
// en-CA форматирует дату ровно как YYYY-MM-DD.
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
}

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

  // Дайджесты + участники собираем параллельно (best-effort на каждый проект).
  const digests = await Promise.all(
    creatable.map(async (p) => {
      let digest: string | null = null;
      try {
        digest = await prepareKbContext(p, userId, deps, DIGEST_LIMITS);
      } catch {
        digest = null;
      }
      // Ответственным может быть любой участник проекта, включая viewer и автора.
      let memberLine = '';
      try {
        const list = await deps.members.listByProject(p.id);
        const eligible = list
          .slice(0, MAX_MEMBERS_PER_PROJECT)
          .map((m) => `[userId=${m.userId}] ${m.user.displayName}`);
        memberLine =
          eligible.length > 0
            ? `Участники (варианты ответственного): ${eligible.join('; ')}`
            : 'Участники проекта не найдены';
      } catch {
        memberLine = '';
      }
      return { projectId: p.id, name: p.name, digest, memberLine };
    }),
  );

  const candidates: ComposeCandidate[] = digests.map((d) => ({
    projectId: d.projectId,
    name: d.name,
  }));

  const parts: string[] = [];
  let total = 0;
  let memberTotal = 0;
  for (const d of digests) {
    const body = d.digest && d.digest.trim().length > 0 ? d.digest.trim() : '(KB не подключена)';
    // Участники — со своим потолком, отдельно от KB (см. MAX_MEMBER_TOTAL_CHARS).
    let memberPart = '';
    if (d.memberLine && memberTotal + d.memberLine.length <= MAX_MEMBER_TOTAL_CHARS) {
      memberPart = `${d.memberLine}\n`;
      memberTotal += d.memberLine.length;
    }
    const part = `[projectId=${d.projectId}] ${d.name}\n${memberPart}${body}`;
    if (total + part.length > MAX_TOTAL_CHARS) {
      // Дальше не лезем, но сам проект (хотя бы имя + участники) всё равно полезен —
      // добавим усечённый заголовок без дайджеста, чтобы id/ответственные остались модели.
      const header = `[projectId=${d.projectId}] ${d.name}\n${memberPart}(дайджест опущен — лимит контекста)`;
      if (total + header.length <= MAX_TOTAL_CHARS) {
        parts.push(header);
        total += header.length;
      }
      continue;
    }
    parts.push(part);
    total += part.length;
  }

  // «Сегодня» — в начале блока: модель резолвит относительные сроки от этой даты.
  const block = `Сегодня: ${todayIso()}\n\n${parts.join('\n\n---\n\n')}`;
  return { block, candidates };
}
