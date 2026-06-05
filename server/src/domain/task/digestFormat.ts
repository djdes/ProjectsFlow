import type { TaskPriority, TaskStatus } from './Task.js';

// Приоритет в дайджесте: словесный label + цветной эмодзи-маркер (нотация P1..P4 убрана).
export const PRIORITY_DIGEST_META: Record<TaskPriority, { label: string; emoji: string }> = {
  1: { label: 'Срочно', emoji: '🔴' },
  2: { label: 'Высокий', emoji: '🟠' },
  3: { label: 'Средний', emoji: '🔵' },
  4: { label: 'Низкий', emoji: '⚪' },
};

export const NO_PRIORITY_LABEL = 'Без приоритета';

// Подписи колонок для группировки сводки по статусу (совпадают с client statusLabels).
export const STATUS_DIGEST_LABEL: Record<TaskStatus, string> = {
  backlog: 'Черновики',
  manual: 'Вручную',
  todo: 'Воркер',
  in_progress: 'В работе',
  awaiting_clarification: 'На уточнении',
  done: 'Готово',
};

// Визуальная колонка: in_progress/awaiting_clarification живут в колонке «Воркер» (todo).
export function toVisibleStatus(status: TaskStatus): TaskStatus {
  if (status === 'in_progress' || status === 'awaiting_clarification') return 'todo';
  return status;
}

// Заголовок группы: «🟠 Приоритет: Высокий» или «Без приоритета».
export function priorityHeading(p: TaskPriority | null): string {
  if (p === null) return NO_PRIORITY_LABEL;
  const m = PRIORITY_DIGEST_META[p];
  return `${m.emoji} Приоритет: ${m.label}`;
}

// Делит описание на заголовок-анкор (первая непустая строка, очищенная от markdown —
// она же текст кликабельной ссылки) и тело (всё остальное как есть, с markdown-вёрсткой).
// Не обрезаем: пользователь хочет полный текст задачи (см. фидбэк).
export function splitDescription(description: string | null): { name: string; body: string } {
  const lines = (description ?? '').replace(/\r/g, '').split('\n');
  const idx = lines.findIndex((l) => l.trim().length > 0);
  if (idx === -1) return { name: '(без описания)', body: '' };
  const stripped = stripMarkdownInline(lines[idx]!.trim());
  const name = stripped.length === 0 ? '(без описания)' : stripped;
  const body = lines.slice(idx + 1).join('\n').trim();
  return { name, body };
}

// Грубая чистка inline-markdown одной строки-заголовка.
function stripMarkdownInline(s: string): string {
  return s
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// RU-дата дедлайна: «сегодня/завтра/вчера» для близких, иначе «5 июн» / «5 июн 2026».
export function formatDeadlineRu(iso: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'завтра';
  if (diffDays === -1) return 'вчера';
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Инлайн-markdown → безопасный HTML: ссылки, **жирный**, ~~зачёркнутый~~, <u>подчёркнутый</u>,
// *курсив*, `код`. Текст экранируется ПЕРВЫМ, поэтому теги всегда сбалансированы и валидны
// (важно для Telegram HTML — иначе bot API вернёт 400). Набор форматов синхронизирован с
// клиентским конвертером `client/src/lib/telegramHtml.ts` (меню форматирования полей задач).
function inlineMd(s: string): string {
  let t = escapeHtml(s);
  // Восстановить парный <u>…</u> (в markdown подчёркивания нет — меню пишет сырой тег).
  // Контент внутри остаётся экранированным, поэтому XSS-безопасно. <u> поддерживает и Telegram.
  t = t.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  t = t.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  t = t.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  t = t.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>');
  return t;
}

// markdown тела задачи → HTML. mode='email' — блочный (<p>/<ul>/<pre>);
// mode='telegram' — инлайн-теги + переводы строк (Telegram HTML не знает блочных тегов).
export function markdownToRich(md: string, mode: 'email' | 'telegram'): string {
  const lines = (md ?? '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let inUl = false;
  let inCode = false;
  let code: string[] = [];

  const closeUl = (): void => {
    if (inUl && mode === 'email') out.push('</ul>');
    inUl = false;
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inCode) {
        closeUl();
        inCode = true;
        code = [];
      } else {
        inCode = false;
        const c = escapeHtml(code.join('\n'));
        out.push(
          mode === 'email'
            ? `<pre style="background:#f1f5f9;padding:8px;border-radius:6px;overflow:auto;font-size:12px;white-space:pre-wrap;">${c}</pre>`
            : `<pre>${c}</pre>`,
        );
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const t = line.trim();
    if (t === '') {
      closeUl();
      if (mode === 'email') out.push('<div style="height:6px"></div>');
      else out.push('');
      continue;
    }

    const h = /^(#{1,6})\s+(.+)$/.exec(t);
    if (h) {
      closeUl();
      const x = inlineMd(h[2]!);
      out.push(mode === 'email' ? `<p style="margin:6px 0 2px;font-weight:600">${x}</p>` : `<b>${x}</b>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(t);
    if (bullet) {
      const x = inlineMd(bullet[1]!);
      if (mode === 'email') {
        if (!inUl) {
          out.push('<ul style="margin:2px 0;padding-left:20px">');
          inUl = true;
        }
        out.push(`<li>${x}</li>`);
      } else {
        out.push(`• ${x}`);
      }
      continue;
    }

    const num = /^(\d+)\.\s+(.+)$/.exec(t);
    if (num) {
      closeUl();
      const x = inlineMd(num[2]!);
      out.push(mode === 'email' ? `<p style="margin:1px 0">${escapeHtml(num[1]!)}. ${x}</p>` : `${num[1]}. ${x}`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(t);
    if (quote) {
      closeUl();
      const x = inlineMd(quote[1]!);
      out.push(
        mode === 'email'
          ? `<blockquote style="margin:4px 0;padding-left:10px;border-left:3px solid #cbd5e1;color:#475569">${x}</blockquote>`
          : `<blockquote>${x}</blockquote>`,
      );
      continue;
    }

    closeUl();
    const x = inlineMd(t);
    out.push(mode === 'email' ? `<p style="margin:2px 0">${x}</p>` : x);
  }
  closeUl();
  if (inCode) {
    const c = escapeHtml(code.join('\n'));
    out.push(`<pre>${c}</pre>`);
  }
  return mode === 'email' ? out.join('') : out.join('\n');
}
