import type { TaskPriority } from '../../../domain/task/Task.js';
import type { TaskWithCounts } from '../ListTasks.js';
import {
  NO_PRIORITY_LABEL,
  PRIORITY_DIGEST_META,
  escapeHtml,
  escapeMarkdownV2,
  escapeMarkdownV2Url,
  formatDeadlineRu,
  taskNameFromDescription,
} from '../../../domain/task/digestFormat.js';

// Один элемент дайджеста — готовые к рендеру поля (имя, RU-дедлайн, исполнитель, ссылка).
export type DigestItem = {
  readonly name: string;
  readonly deadline: string | null;
  readonly assignee: string | null;
  readonly link: string;
};

export type DigestGroup = {
  readonly priority: TaskPriority | null;
  readonly heading: string;
  readonly items: DigestItem[];
};

export type DigestModel = {
  readonly projectName: string;
  readonly count: number;
  readonly groups: DigestGroup[];
};

export type BuildDigestOptions = {
  readonly projectName: string;
  readonly appUrl: string;
  readonly isInbox: boolean;
  // Подменяемое «сейчас» для детерминированных тестов RU-дат.
  readonly now?: Date;
};

// Порядок групп: P1→P2→P3→P4, затем «без приоритета».
const PRIORITY_ORDER: readonly (TaskPriority | null)[] = [1, 2, 3, 4, null];

// Сборка модели дайджеста: группировка по приоритету, сортировка внутри по position.
export function buildDigestModel(
  tasks: readonly TaskWithCounts[],
  opts: BuildDigestOptions,
): DigestModel {
  const base = opts.appUrl.replace(/\/+$/, '');
  const groups: DigestGroup[] = [];
  for (const pr of PRIORITY_ORDER) {
    const inGroup = tasks
      .filter((t) => (t.priority ?? null) === pr)
      .sort((a, b) => a.position - b.position);
    if (inGroup.length === 0) continue;
    const heading =
      pr === null
        ? NO_PRIORITY_LABEL
        : `${PRIORITY_DIGEST_META[pr].emoji} ${PRIORITY_DIGEST_META[pr].short} · ${PRIORITY_DIGEST_META[pr].label}`;
    const items: DigestItem[] = inGroup.map((t) => ({
      name: taskNameFromDescription(t.description),
      deadline: t.deadline ? formatDeadlineRu(t.deadline, opts.now) : null,
      assignee: t.delegation?.delegateDisplayName ?? null,
      link: `${base}/${opts.isInbox ? 'inbox' : `projects/${t.projectId}`}?task=${t.id}`,
    }));
    groups.push({ priority: pr, heading, items });
  }
  return { projectName: opts.projectName, count: tasks.length, groups };
}

// === Рендереры (чистые функции от модели → строка в нужном формате) ===

// Plain-text — для буфера обмена.
export function renderDigestText(m: DigestModel): string {
  const lines: string[] = [`Задачи — ${m.count} · Проект «${m.projectName}»`];
  for (const g of m.groups) {
    lines.push('');
    lines.push(g.heading);
    g.items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.name}`);
      const meta: string[] = [];
      if (it.deadline) meta.push(`⏰ ${it.deadline}`);
      if (it.assignee) meta.push(`👤 ${it.assignee}`);
      meta.push(`🔗 ${it.link}`);
      lines.push(`   ${meta.join(' · ')}`);
    });
  }
  return lines.join('\n');
}

// HTML — для письма.
export function renderDigestHtml(m: DigestModel): string {
  const parts: string[] = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;line-height:1.5;">',
    `<p style="font-size:15px;font-weight:600;margin:0 0 12px;">Задачи — ${m.count} · Проект «${escapeHtml(
      m.projectName,
    )}»</p>`,
  ];
  for (const g of m.groups) {
    parts.push(
      `<p style="font-size:13px;font-weight:600;margin:14px 0 6px;">${escapeHtml(g.heading)}</p>`,
    );
    parts.push('<ol style="margin:0;padding:0 0 0 18px;">');
    for (const it of g.items) {
      const meta: string[] = [];
      if (it.deadline) meta.push(`⏰ ${escapeHtml(it.deadline)}`);
      if (it.assignee) meta.push(`👤 ${escapeHtml(it.assignee)}`);
      meta.push(`<a href="${escapeHtml(it.link)}" style="color:#2563eb;text-decoration:none;">открыть</a>`);
      parts.push(
        `<li style="margin:0 0 8px;">${escapeHtml(it.name)}<br>` +
          `<span style="color:#64748b;font-size:12px;">${meta.join(' · ')}</span></li>`,
      );
    }
    parts.push('</ol>');
  }
  parts.push('</div>');
  return parts.join('');
}

// Telegram MarkdownV2 — для бота.
export function renderDigestMarkdownV2(m: DigestModel): string {
  const e = escapeMarkdownV2;
  const lines: string[] = [`*Задачи — ${e(String(m.count))} · ${e(`Проект «${m.projectName}»`)}*`];
  for (const g of m.groups) {
    lines.push('');
    lines.push(`*${e(g.heading)}*`);
    g.items.forEach((it, i) => {
      lines.push(`${e(`${i + 1}.`)} ${e(it.name)}`);
      const meta: string[] = [];
      if (it.deadline) meta.push(`⏰ ${e(it.deadline)}`);
      if (it.assignee) meta.push(`👤 ${e(it.assignee)}`);
      meta.push(`[${e('открыть')}](${escapeMarkdownV2Url(it.link)})`);
      lines.push(`   ${meta.join(' · ')}`);
    });
  }
  return lines.join('\n');
}
