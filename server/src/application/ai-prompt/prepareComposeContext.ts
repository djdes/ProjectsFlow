import { hasOwnerRights } from '../../domain/project/permissions.js';
import type { ListProjects } from '../project/ListProjects.js';
import type { ListKbDocuments } from '../kb/ListKbDocuments.js';
import type { GetKbDocument } from '../kb/GetKbDocument.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import { prepareKbContext } from './prepareKbContext.js';
import { moscowDateOnly } from '../../domain/time/moscowDate.js';

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
// Открытые задачи проекта — кандидаты на дополнение вместо создания дубля (B3).
// Держим коротким: заголовок задачи модели хватает, чтобы узнать «про это уже есть».
const MAX_TASKS_PER_PROJECT = 20;
const MAX_TASK_EXCERPT_CHARS = 100;
// Свой потолок, как у участников: список задач не должен вытеснить KB-дайджесты.
const MAX_TASK_TOTAL_CHARS = 15_000;
// Какие статусы считаем «открытыми» — задача в них ещё может быть дополнена.
const OPEN_STATUSES = new Set<TaskStatus>([
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'manual',
]);

type Deps = {
  readonly listProjects: ListProjects;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
  readonly members: ProjectMemberRepository;
  // Открытые задачи проектов-кандидатов. Опционально: без него блок задач просто
  // не собирается, compose работает как раньше (все сегменты — новые задачи).
  readonly tasks?: Pick<TaskRepository, 'listByProjects'>;
};

// Однострочная выжимка задачи для промпта: первая строка описания (заголовок) без
// markdown-шума. Совпадает по смыслу с тем, что пользователь видит на карточке.
function taskExcerpt(description: string | null): string {
  const firstLine = (description ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const clean = (firstLine ?? '').replace(/[*_`#>]/g, '').trim();
  return clean.length <= MAX_TASK_EXCERPT_CHARS
    ? clean
    : `${clean.slice(0, MAX_TASK_EXCERPT_CHARS - 1).trimEnd()}…`;
}

// Сегодняшняя дата в формате YYYY-MM-DD. Нужна модели, чтобы резолвить относительные
// сроки («на сегодня», «до конца недели»). Зона продукта — см. moscowDateOnly.
function todayIso(): string {
  return moscowDateOnly(new Date());
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
    .filter((p) => (p.role === 'editor' || hasOwnerRights(p.role)) && !p.isInbox)
    .slice(0, MAX_PROJECTS);
  if (creatable.length === 0) return null;

  // Открытые задачи всех кандидатов одним запросом (best-effort: без них compose
  // просто не предложит дополнить существующую задачу).
  const openTasksByProject = new Map<string, string[]>();
  if (deps.tasks) {
    try {
      const all = await deps.tasks.listByProjects(creatable.map((p) => p.id));
      for (const t of all) {
        if (!OPEN_STATUSES.has(t.status)) continue;
        const bucket = openTasksByProject.get(t.projectId) ?? [];
        if (bucket.length >= MAX_TASKS_PER_PROJECT) continue;
        const excerpt = taskExcerpt(t.description);
        if (excerpt.length === 0) continue;
        bucket.push(`[taskId=${t.id}] ${excerpt}`);
        openTasksByProject.set(t.projectId, bucket);
      }
    } catch {
      openTasksByProject.clear();
    }
  }

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
  let taskTotal = 0;
  for (const d of digests) {
    const body = d.digest && d.digest.trim().length > 0 ? d.digest.trim() : '(KB не подключена)';
    // Участники — со своим потолком, отдельно от KB (см. MAX_MEMBER_TOTAL_CHARS).
    let memberPart = '';
    if (d.memberLine && memberTotal + d.memberLine.length <= MAX_MEMBER_TOTAL_CHARS) {
      memberPart = `${d.memberLine}\n`;
      memberTotal += d.memberLine.length;
    }
    // Открытые задачи — тоже со своим потолком (см. MAX_TASK_TOTAL_CHARS).
    let taskPart = '';
    const openTasks = openTasksByProject.get(d.projectId) ?? [];
    if (openTasks.length > 0) {
      const line = `Открытые задачи (кандидаты на дополнение): ${openTasks.join('; ')}`;
      if (taskTotal + line.length <= MAX_TASK_TOTAL_CHARS) {
        taskPart = `${line}\n`;
        taskTotal += line.length;
      }
    }
    const part = `[projectId=${d.projectId}] ${d.name}\n${memberPart}${taskPart}${body}`;
    if (total + part.length > MAX_TOTAL_CHARS) {
      // Дальше не лезем, но сам проект (хотя бы имя + участники) всё равно полезен —
      // добавим усечённый заголовок без дайджеста, чтобы id/ответственные остались модели.
      const header = `[projectId=${d.projectId}] ${d.name}\n${memberPart}${taskPart}(дайджест опущен — лимит контекста)`;
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
