import type { TaskPriority, TaskStatus } from '../../../domain/task/Task.js';
import type { TaskWithCounts } from '../ListTasks.js';
import {
  STATUS_DIGEST_LABEL,
  escapeHtml,
  formatDeadlineRu,
  markdownToRich,
  priorityHeading,
  splitDescription,
  toVisibleStatus,
} from '../../../domain/task/digestFormat.js';

export type DigestAttachment = { readonly name: string; readonly url: string };

export type DigestItem = {
  readonly name: string; // первая строка описания — текст анкора
  readonly body: string; // остальное описание (markdown, сохраняем вёрстку)
  readonly deadline: string | null;
  readonly assignee: string | null;
  readonly openLink: string; // ?task=… — открыть задачу
  readonly doneLink: string; // ?task=…&done=1 — перенести в «Готово»
  readonly attachments: DigestAttachment[];
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

// Группировка: по приоритету (ручной экспорт) или по колонкам-статусам (сводка).
export type DigestGrouping =
  | { readonly by: 'priority' }
  | { readonly by: 'status'; readonly statuses: readonly TaskStatus[] };

export type BuildDigestOptions = {
  readonly projectName: string;
  readonly appUrl: string;
  readonly isInbox: boolean;
  readonly attachmentsByTask: ReadonlyMap<string, DigestAttachment[]>;
  // По умолчанию — по приоритету. Сводка использует { by: 'status', statuses }.
  readonly grouping?: DigestGrouping;
  // Подменяемое «сейчас» для детерминированных тестов RU-дат.
  readonly now?: Date;
};

const PRIORITY_ORDER: readonly (TaskPriority | null)[] = [1, 2, 3, 4, null];

// Сборка модели дайджеста. Приоритетная группировка: P1→P4→без (внутри по position,
// без приоритета — по дате создания, старые первыми). Статусная: по выбранным колонкам.
export function buildDigestModel(
  tasks: readonly TaskWithCounts[],
  opts: BuildDigestOptions,
): DigestModel {
  const base = opts.appUrl.replace(/\/+$/, '');
  const grouping = opts.grouping ?? { by: 'priority' };
  const mapItem = (t: TaskWithCounts): DigestItem => {
    const { name, body } = splitDescription(t.description);
    const linkBase = `${base}/${opts.isInbox ? 'inbox' : `projects/${t.projectId}`}?task=${t.id}`;
    return {
      name,
      body,
      deadline: t.deadline ? formatDeadlineRu(t.deadline, opts.now) : null,
      assignee: t.delegation?.delegateDisplayName ?? null,
      openLink: linkBase,
      doneLink: `${linkBase}&done=1`,
      attachments: [...(opts.attachmentsByTask.get(t.id) ?? [])],
    };
  };

  const groups: DigestGroup[] = [];
  if (grouping.by === 'status') {
    for (const st of grouping.statuses) {
      const inGroup = tasks
        .filter((t) => toVisibleStatus(t.status) === st)
        .sort((a, b) => a.position - b.position);
      if (inGroup.length === 0) continue;
      groups.push({ priority: null, heading: STATUS_DIGEST_LABEL[st], items: inGroup.map(mapItem) });
    }
  } else {
    for (const pr of PRIORITY_ORDER) {
      const inGroup = tasks.filter((t) => (t.priority ?? null) === pr);
      if (inGroup.length === 0) continue;
      inGroup.sort(
        pr === null
          ? (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
          : (a, b) => a.position - b.position,
      );
      groups.push({ priority: pr, heading: priorityHeading(pr), items: inGroup.map(mapItem) });
    }
  }
  return { projectName: opts.projectName, count: tasks.length, groups };
}

// === Рендереры ===

// Markdown — для буфера обмена (имя-анкор жирным, ✓Готово-ссылка, полное тело, вложения).
export function renderDigestMarkdown(m: DigestModel): string {
  const lines: string[] = [`**Задачи — ${m.count} · Проект «${m.projectName}»**`];
  for (const g of m.groups) {
    lines.push('');
    lines.push(`**${g.heading}**`);
    g.items.forEach((it, i) => {
      lines.push('');
      lines.push(`${i + 1}. **[${it.name}](${it.openLink})** · [✓ Готово](${it.doneLink})`);
      const meta: string[] = [];
      if (it.deadline) meta.push(`⏰ ${it.deadline}`);
      if (it.assignee) meta.push(`👤 ${it.assignee}`);
      if (meta.length) lines.push(meta.join(' · '));
      if (it.body) lines.push(it.body);
      if (it.attachments.length) {
        lines.push(it.attachments.map((a) => `📎 [${a.name}](${a.url})`).join(' · '));
      }
    });
  }
  return lines.join('\n');
}

// HTML — для письма.
export function renderDigestHtml(m: DigestModel): string {
  const p: string[] = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;line-height:1.5;">',
    `<p style="font-size:15px;font-weight:700;margin:0 0 12px;">Задачи — ${m.count} · Проект «${escapeHtml(
      m.projectName,
    )}»</p>`,
  ];
  for (const g of m.groups) {
    p.push(`<p style="font-size:13px;font-weight:600;margin:16px 0 8px;">${escapeHtml(g.heading)}</p>`);
    g.items.forEach((it, i) => {
      p.push('<div style="margin:0 0 16px;border-left:3px solid #e2e8f0;padding-left:10px;">');
      p.push(
        `<div style="font-weight:600;">${i + 1}. <a href="${escapeHtml(
          it.openLink,
        )}" style="color:#2563eb;text-decoration:none;">${escapeHtml(
          it.name,
        )}</a> · <a href="${escapeHtml(it.doneLink)}" style="color:#16a34a;text-decoration:none;">✓ Готово</a></div>`,
      );
      const meta: string[] = [];
      if (it.deadline) meta.push(`⏰ ${escapeHtml(it.deadline)}`);
      if (it.assignee) meta.push(`👤 ${escapeHtml(it.assignee)}`);
      if (meta.length) p.push(`<div style="color:#64748b;font-size:12px;margin:2px 0;">${meta.join(' · ')}</div>`);
      if (it.body) p.push(`<div style="font-size:13px;margin:4px 0;">${markdownToRich(it.body, 'email')}</div>`);
      if (it.attachments.length) {
        p.push(
          `<div style="font-size:12px;margin:4px 0;">${it.attachments
            .map((a) => `📎 <a href="${escapeHtml(a.url)}" style="color:#2563eb;">${escapeHtml(a.name)}</a>`)
            .join(' · ')}</div>`,
        );
      }
      p.push('</div>');
    });
  }
  p.push('</div>');
  return p.join('');
}

// Telegram (parse_mode HTML). Урезаем на границе задач, чтобы не превысить 4096.
// assigneeFirst — для отправки в группу: каждая задача начинается с исполнителя
// «👤 Анна — …» (или «👤 — …», если не делегирована).
export function renderDigestTelegram(
  m: DigestModel,
  opts: { maxLen?: number; assigneeFirst?: boolean } = {},
): string {
  const maxLen = opts.maxLen ?? 3800;
  const segs: string[] = [
    `<b>Задачи — ${m.count} · ${escapeHtml(`Проект «${m.projectName}»`)}</b>`,
  ];
  let used = segs[0]!.length;
  let cut = false;
  for (const g of m.groups) {
    if (cut) break;
    const headingSeg = `\n\n<b>${escapeHtml(g.heading)}</b>`;
    let headingAdded = false;
    for (let i = 0; i < g.items.length; i++) {
      const it = g.items[i]!;
      const meta: string[] = [];
      if (it.deadline) meta.push(`⏰ ${escapeHtml(it.deadline)}`);
      // assigneeFirst: исполнитель в начале строки, иначе — в мете.
      if (!opts.assigneeFirst && it.assignee) meta.push(`👤 ${escapeHtml(it.assignee)}`);
      const prefix = opts.assigneeFirst
        ? it.assignee
          ? `👤 ${escapeHtml(it.assignee)} — `
          : '👤 — '
        : '';
      const itemLines: string[] = [
        `${i + 1}. ${prefix}<a href="${escapeHtml(it.openLink)}">${escapeHtml(
          it.name,
        )}</a> · <a href="${escapeHtml(it.doneLink)}">✓ Готово</a>`,
      ];
      if (meta.length) itemLines.push(meta.join(' · '));
      if (it.body) itemLines.push(markdownToRich(it.body, 'telegram'));
      if (it.attachments.length) {
        itemLines.push(
          it.attachments.map((a) => `📎 <a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>`).join(' · '),
        );
      }
      const itemSeg = '\n\n' + itemLines.join('\n');
      const add = (headingAdded ? 0 : headingSeg.length) + itemSeg.length;
      if (used + add > maxLen) {
        cut = true;
        break;
      }
      if (!headingAdded) {
        segs.push(headingSeg);
        used += headingSeg.length;
        headingAdded = true;
      }
      segs.push(itemSeg);
      used += itemSeg.length;
    }
  }
  if (cut) segs.push('\n\n…(сообщение длинное — полностью на сайте)');
  return segs.join('');
}
