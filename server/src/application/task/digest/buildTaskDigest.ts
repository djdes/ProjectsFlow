import type { TaskPriority, TaskStatus } from '../../../domain/task/Task.js';
import type { TaskWithCounts } from '../ListTasks.js';
import {
  STATUS_DIGEST_LABEL,
  escapeHtml,
  formatDeadlineRu,
  markdownToRich,
  priorityHeading,
  splitDescription,
  stripFigureLines,
  toVisibleStatus,
} from '../../../domain/task/digestFormat.js';

export type DigestAttachment = { readonly name: string; readonly url: string };

export type DigestItem = {
  readonly taskId: string; // id задачи — ключ для токен-ссылок действий в письме
  readonly name: string; // первая строка описания — текст анкора
  readonly body: string; // остальное описание (markdown, сохраняем вёрстку)
  readonly deadline: string | null;
  readonly assignee: string | null;
  readonly openLink: string; // ?task=… — открыть задачу (карточка с комментариями)
  readonly doneLink: string; // ?task=…&done=1 — перенести в «Готово»
  readonly commentCount: number; // кол-во комментариев у задачи (для «Комментировать (N)»)
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
      taskId: t.id,
      name,
      body,
      deadline: t.deadline ? formatDeadlineRu(t.deadline, opts.now) : null,
      assignee: t.delegation?.delegateDisplayName ?? null,
      openLink: linkBase,
      doneLink: `${linkBase}&done=1`,
      commentCount: t.commentCount ?? 0,
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
      if (it.body) {
        const b = stripFigureLines(it.body); // сырой <figure> в plain-text не нужен
        if (b) lines.push(b);
      }
      if (it.attachments.length) {
        lines.push(it.attachments.map((a) => `📎 [${a.name}](${a.url})`).join(' · '));
      }
    });
  }
  return lines.join('\n');
}

// Кнопка-плашка письма (bulletproof: <a> с inline-стилями, display:inline-block).
// variant 'primary' — зелёная заливка (Завершить); 'ghost' — синяя контурная (Комментировать).
function emailButton(href: string, label: string, variant: 'primary' | 'ghost'): string {
  const style =
    variant === 'primary'
      ? 'background:#16a34a;color:#ffffff;border:1px solid #16a34a;'
      : 'background:#ffffff;color:#2563eb;border:1px solid #bfdbfe;';
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;text-decoration:none;` +
    `font-size:13px;font-weight:700;line-height:1;padding:10px 16px;border-radius:8px;${style}">` +
    `${escapeHtml(label)}</a>`
  );
}

// Токен-ссылки one-click действий письма (по taskId). Если переданы — кнопки ведут на
// /api/email-actions/…; иначе fallback на deep-links в приложение (как у Telegram).
export type DigestEmailUrls = ReadonlyMap<string, { completeUrl: string; commentUrl: string }>;

// HTML письма-сводки — фирменный стиль (градиентная шапка, карточки), кнопки «Комментировать» +
// «Завершить» внизу каждой задачи. Стиль письма богаче TG (TG остаётся на deep-links).
export function renderDigestHtml(
  m: DigestModel,
  opts: {
    actionUrls?: DigestEmailUrls;
    // Резолвер картинок-фигур описания → подписанный <img src>. Без него картинки не вставляются.
    resolveImageUrl?: (rawSrc: string) => string | null;
  } = {},
): string {
  const p: string[] = [
    '<div style="background:#f1f5f9;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">',
    '<div style="max-width:560px;margin:0 auto;padding:0 16px;">',
    '<div style="background:#2563eb;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:16px 16px 0 0;padding:18px 20px;color:#ffffff;">',
    '<div style="font-weight:800;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85;">ProjectsFlow · Ежедневная сводка</div>',
    `<div style="font-weight:800;font-size:20px;letter-spacing:-.02em;margin:4px 0 0;">${escapeHtml(
      m.projectName,
    )}</div>`,
    `<div style="font-size:13px;opacity:.9;margin:2px 0 0;">Задач: ${m.count}</div>`,
    '</div>',
    '<div style="background:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px;padding:8px 16px 16px;color:#0f172a;line-height:1.5;">',
  ];
  for (const g of m.groups) {
    p.push(
      `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin:14px 0 8px;">${escapeHtml(
        g.heading,
      )}</div>`,
    );
    for (const it of g.items) {
      const urls = opts.actionUrls?.get(it.taskId);
      const completeHref = urls?.completeUrl ?? it.doneLink;
      const commentHref = urls?.commentUrl ?? it.openLink;
      p.push(
        '<div style="margin:0 0 10px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#ffffff;">',
      );
      p.push(`<div style="font-weight:700;font-size:15px;">${escapeHtml(it.name)}</div>`);
      const meta: string[] = [];
      if (it.assignee) meta.push(`👤 ${escapeHtml(it.assignee)}`);
      if (it.deadline) meta.push(`⏰ ${escapeHtml(it.deadline)}`);
      if (meta.length) p.push(`<div style="color:#64748b;font-size:12px;margin:4px 0 0;">${meta.join(' · ')}</div>`);
      if (it.body) p.push(`<div style="font-size:13px;color:#334155;margin:6px 0 0;">${markdownToRich(it.body, 'email', { resolveImageUrl: opts.resolveImageUrl })}</div>`);
      if (it.attachments.length) {
        p.push(
          `<div style="font-size:12px;margin:6px 0 0;">${it.attachments
            .map((a) => `📎 <a href="${escapeHtml(a.url)}" style="color:#2563eb;">${escapeHtml(a.name)}</a>`)
            .join(' · ')}</div>`,
        );
      }
      const commentLabel =
        it.commentCount > 0 ? `💬 Комментировать (${it.commentCount})` : '💬 Комментировать';
      p.push(
        '<div style="margin:12px 0 2px;">' +
          emailButton(commentHref, commentLabel, 'ghost') +
          '&nbsp;&nbsp;' +
          emailButton(completeHref, '✓ Завершить', 'primary') +
          '</div>',
      );
      p.push('</div>');
    }
  }
  p.push('</div></div></div>');
  return p.join('');
}

// Блок одной задачи для Telegram: жирный заголовок (НЕ ссылка) → мета (👤/⏰) → тело →
// вложения → футер «Комментировать (N) | Завершить» (гиперссылки на сайт). Если блок не
// влезает в maxBlock — усекаем ТОЛЬКО тело (по сырому markdown, затем re-render, чтобы HTML
// остался сбалансированным и Telegram не отбил parse_mode).
function digestItemBlockTg(it: DigestItem, maxBlock: number): string {
  const title = `<b>${escapeHtml(it.name)}</b>`;
  const meta: string[] = [];
  if (it.assignee) meta.push(`👤 ${escapeHtml(it.assignee)}`);
  if (it.deadline) meta.push(`⏰ ${escapeHtml(it.deadline)}`);
  const commentLabel =
    it.commentCount > 0 ? `Комментировать (${it.commentCount})` : 'Комментировать';
  const footer =
    `<a href="${escapeHtml(it.openLink)}">${commentLabel}</a>` +
    ` | <a href="${escapeHtml(it.doneLink)}">Завершить</a>`;
  const attach = it.attachments.length
    ? it.attachments.map((a) => `📎 <a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>`).join(' · ')
    : '';
  const compose = (body: string): string =>
    [title, meta.join(' · '), body, attach, footer].filter((s) => s.length > 0).join('\n');

  let block = compose(it.body ? markdownToRich(it.body, 'telegram') : '');
  if (block.length > maxBlock) {
    const room = maxBlock - compose('').length - 1;
    block =
      room > 40 && it.body
        ? compose(markdownToRich(it.body.slice(0, room).trimEnd() + '…', 'telegram'))
        : compose('');
    if (block.length > maxBlock) block = compose(''); // тело всё равно не влезает — без него
  }
  return block;
}

// Telegram (parse_mode HTML). Возвращает МАССИВ сообщений: длинная сводка разбивается на
// несколько сообщений, ВСЕ задачи показываются полностью (без «…на сайте»). Заголовок проекта
// на первом сообщении, «…(продолжение)» — на следующих. Группа-заголовок повторяется в начале
// каждого сообщения, где есть её задачи.
export function renderDigestTelegram(m: DigestModel, opts: { maxLen?: number } = {}): string[] {
  const maxLen = opts.maxLen ?? 3800;
  const header = `<b>Задачи — ${m.count} · ${escapeHtml(`Проект «${m.projectName}»`)}</b>`;
  const cont = '<b>…(продолжение)</b>';
  const chunks: string[] = [];
  let cur = header;
  let groupInChunk: string | null = null; // заголовок группы, уже добавленный в текущий чанк

  for (const g of m.groups) {
    const heading = `<b>${escapeHtml(g.heading)}</b>`;
    for (const it of g.items) {
      const block = digestItemBlockTg(it, maxLen - 120); // запас под cont+heading
      const needHeading = groupInChunk !== g.heading;
      const addLen = (needHeading ? heading.length + 2 : 0) + block.length + 2;
      // Перенос на новое сообщение только если в текущем уже есть задачи (groupInChunk != null).
      if (groupInChunk !== null && cur.length + addLen > maxLen) {
        chunks.push(cur);
        cur = cont;
        groupInChunk = null;
      }
      if (groupInChunk !== g.heading) {
        cur += '\n\n' + heading;
        groupInChunk = g.heading;
      }
      cur += '\n\n' + block;
    }
  }
  chunks.push(cur);
  return chunks;
}

// Богатый рендер для sendRichMessage (Bot API 10.1): заголовки разного размера + таблицы
// задач по группам (рамки/чередование). ВЫДЕЛЯЕМЫЙ текст, не картинка — тот самый Hermes-вид.
// Возвращает ОДНУ HTML-строку (Telegram сам парсит её в блоки). Для очень длинных сводок
// caller делает фоллбэк на renderDigestTelegram, если sendRichMessage вернёт ошибку.
export function renderDigestRich(m: DigestModel): string {
  const h: string[] = [
    `<h2>🗒 Ежедневная сводка · «${escapeHtml(m.projectName)}»</h2>`,
    `<p>Открытых задач: <b>${m.count}</b></p>`,
  ];
  for (const g of m.groups) {
    h.push(`<h3>${escapeHtml(g.heading)}</h3>`);
    h.push('<table bordered striped>');
    h.push('<tr><th>Задача</th><th>Кто</th><th>Дедлайн</th></tr>');
    for (const it of g.items) {
      const who = it.assignee ? escapeHtml(it.assignee) : '—';
      const dl = it.deadline ? escapeHtml(it.deadline) : '—';
      h.push(
        `<tr><td><b>${escapeHtml(it.name)}</b></td><td>${who}</td><td>${dl}</td></tr>`,
      );
    }
    h.push('</table>');
  }
  return h.join('');
}
