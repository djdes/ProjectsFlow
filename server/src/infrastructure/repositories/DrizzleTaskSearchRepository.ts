import { and, desc, eq, inArray, like, type SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, taskComments, tasks } from '../db/schema.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import type {
  TaskSearchQuery,
  TaskSearchRepository,
  TaskSearchResult,
} from '../../application/task/TaskSearchRepository.js';
// Скоуп «только мои проекты» — через единое пространство (workspace_members, is_inbox→owner),
// НЕ project_members (#блокер4) — переиспользуем ProjectMemberRepository (эталон
// DrizzleProjectMemberRepository).
import type { ProjectMemberRepository } from '../../application/project/ProjectMemberRepository.js';
import { activeTasks } from './taskSoftDelete.js';

const EXCERPT_MAX = 160;
// Сколько символов тела комментария показываем вокруг найденного вхождения. Комментарий
// бывает длинным, и совпадение легко оказывается за 160-м символом — тогда подсветка в UI
// не видна вовсе. Поэтому отрывок центрируем по совпадению, а не режем с начала.
const COMMENT_SNIPPET_MAX = 160;

// Экранируем спец-символы LIKE (% _ \), чтобы пользовательский ввод не превратился
// в wildcard. Backslash — дефолтный escape-char MySQL/MariaDB.
function escapeLike(s: string): string {
  return s.replace(/[\%_]/g, (ch) => `\${ch}`);
}

function toExcerpt(description: string | null): string {
  const text = (description ?? '').trim();
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
}

// Отрывок вокруг первого вхождения query (регистронезависимо, ru-locale — как в клиентском
// <Highlight/>). Не нашли вхождение (например, совпадение съел LIKE-escape) — режем с начала.
function toSnippet(body: string | null, query: string): string {
  const text = (body ?? '').trim();
  if (text.length <= COMMENT_SNIPPET_MAX) return text;
  const at = text.toLocaleLowerCase('ru').indexOf(query.trim().toLocaleLowerCase('ru'));
  if (at < 0) return `${text.slice(0, COMMENT_SNIPPET_MAX)}…`;
  // Немного контекста слева, остаток окна — справа от совпадения.
  const from = Math.max(0, at - Math.floor(COMMENT_SNIPPET_MAX / 3));
  const to = Math.min(text.length, from + COMMENT_SNIPPET_MAX);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

export class DrizzleTaskSearchRepository implements TaskSearchRepository {
  constructor(
    private readonly db: Database,
    private readonly projectMembers: ProjectMemberRepository,
  ) {}

  async search(q: TaskSearchQuery): Promise<TaskSearchResult[]> {
    const pattern = `%${escapeLike(q.query)}%`;

    // Скоуп «только мои проекты» — через единое пространство (workspace_members,
    // is_inbox→owner), НЕ project_members (#блокер4: ws-участник без ленивой
    // project_members-строки получал 0 результатов). Без workspaceId — ВСЕ пространства
    // юзера, как и раньше (TaskSearchQuery не несёт workspaceId).
    let scopeCond: SQL | undefined;
    if (!q.includeAllProjects) {
      const accessibleIds = (
        q.workspaceId
          ? await this.projectMembers.listProjectsForUserInWorkspace(q.userId, q.workspaceId)
          : await this.projectMembers.listProjectsForUser(q.userId)
      ).map((p) => p.id);
      if (accessibleIds.length === 0) return [];
      scopeCond = inArray(tasks.projectId, accessibleIds);
    }

    // Описание и комментарии ищем двумя запросами, а не одним OR-JOIN'ом: JOIN на
    // task_comments размножает строки задачи по числу комментариев, и LIMIT начинает резать
    // дубликаты вместо задач. Совпадение в описании приоритетнее — дедуп ниже оставляет его.
    const [byDescription, byComment] = await Promise.all([
      this.searchDescriptions(pattern, scopeCond, q.limit),
      this.searchComments(pattern, scopeCond, q.limit, q.query),
    ]);

    const seen = new Set<string>();
    const merged: TaskSearchResult[] = [];
    for (const r of [...byDescription, ...byComment]) {
      if (seen.has(r.taskId)) continue;
      seen.add(r.taskId);
      merged.push(r);
      if (merged.length === q.limit) break;
    }
    return merged;
  }

  private async searchDescriptions(
    pattern: string,
    scopeCond: SQL | undefined,
    limit: number,
  ): Promise<TaskSearchResult[]> {
    const rows = await this.db
      .select({
        taskId: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        status: tasks.status,
        description: tasks.description,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(activeTasks(like(tasks.description, pattern), scopeCond))
      .orderBy(desc(tasks.updatedAt))
      .limit(limit);

    return rows.map((r) => ({
      taskId: r.taskId,
      projectId: r.projectId,
      projectName: r.projectName,
      status: r.status as TaskStatus,
      excerpt: toExcerpt(r.description),
      createdAt: r.createdAt,
      match: 'description' as const,
    }));
  }

  // Поиск по телу комментариев. Одна задача может дать несколько совпавших комментариев —
  // оставляем самый свежий (строки уже отсортированы по created_at DESC), чтобы результат
  // был одной строкой «задача + место находки», а не N одинаковыми строками.
  private async searchComments(
    pattern: string,
    scopeCond: SQL | undefined,
    limit: number,
    rawQuery: string,
  ): Promise<TaskSearchResult[]> {
    const rows = await this.db
      .select({
        taskId: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        status: tasks.status,
        description: tasks.description,
        createdAt: tasks.createdAt,
        commentId: taskComments.id,
        commentBody: taskComments.body,
      })
      .from(taskComments)
      .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(activeTasks(scopeCond), like(taskComments.body, pattern)))
      .orderBy(desc(taskComments.createdAt))
      // Берём с запасом: несколько совпавших комментариев одной задачи схлопнутся в одну
      // строку, иначе после дедупа задач вышло бы меньше limit.
      .limit(limit * 3);

    const seen = new Set<string>();
    const out: TaskSearchResult[] = [];
    for (const r of rows) {
      if (seen.has(r.taskId)) continue;
      seen.add(r.taskId);
      out.push({
        taskId: r.taskId,
        projectId: r.projectId,
        projectName: r.projectName,
        status: r.status as TaskStatus,
        excerpt: toExcerpt(r.description),
        createdAt: r.createdAt,
        match: 'comment' as const,
        commentId: r.commentId,
        commentExcerpt: toSnippet(r.commentBody, rawQuery),
      });
      if (out.length === limit) break;
    }
    return out;
  }
}
