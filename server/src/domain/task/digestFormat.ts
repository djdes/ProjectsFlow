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

// Строка-картинка из редактора описания: '<figure data-figure-image><img … src="…" …></figure>'.
// Возвращает src (обычно '/api/attachments/<id>') или null, если строка — не картинка-фигура.
const FIGURE_IMG_RE =
  /^<figure\s+data-figure-image>\s*<img\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/figure>$/i;
export function figureImageSrc(line: string): string | null {
  const m = FIGURE_IMG_RE.exec(line.trim());
  return m ? m[1]! : null;
}

// Все src картинок-фигур в описании — для Telegram-альбома (в тексте их не рендерим).
export function extractImageSrcs(md: string | null): string[] {
  const out: string[] = [];
  for (const line of (md ?? '').replace(/\r/g, '').split('\n')) {
    const src = figureImageSrc(line);
    if (src) out.push(src);
  }
  return out;
}

// Полностью снять markdown-разметку → чистый текст. Для мест, где показываем БЕЗ parse_mode
// (например, заголовок inline-кнопки Telegram) или как plain-excerpt: сырые #, **, `, -, >,
// [ссылки], картинки-фигуры не нужны. Многострочно: срезаем блочные маркеры построчно + инлайн.
export function stripAllMarkdown(md: string | null): string {
  const lines = stripFigureLines(md)
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // заголовок
        .replace(/^(\s*)[-*+]\s+/, '$1') // буллет
        .replace(/^(\s*)\d+\.\s+/, '$1') // нумерация
        .replace(/^\s{0,3}>\s?/, ''), // цитата
    );
  return lines
    .join('\n')
    .replace(/<\/?u>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // ![alt](url) → ничего
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // **жирный** / __жирный__
    .replace(/~~(.+?)~~/g, '$1') // ~~зачёркнутый~~
    .replace(/`([^`]+)`/g, '$1') // `код`
    .replace(/(?<![\p{L}\p{N}_*])\*([^*\n]+?)\*(?![\p{L}\p{N}_*])/gu, '$1') // *курсив*
    .replace(/(?<![\p{L}\p{N}_])_([^_\n]+?)_(?![\p{L}\p{N}_])/gu, '$1'); // _курсив_
}

// Убрать строки-картинки из markdown (чтобы сырой <figure> не показывался кодом в TG-тексте).
export function stripFigureLines(md: string | null): string {
  return (md ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => figureImageSrc(l) === null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type MarkdownRichOptions = {
  // Резолвер картинок (email): '/api/attachments/<id>' → абсолютный (подписанный) URL <img>.
  // Не задан или вернул null → картинку не вставляем (сырой тег не показываем).
  readonly resolveImageUrl?: (rawSrc: string) => string | null;
};

// markdown тела задачи → HTML. mode='email' — блочный (<p>/<ul>/<pre>);
// mode='telegram' — инлайн-теги + переводы строк (Telegram HTML не знает блочных тегов).
// Картинки-фигуры: email → настоящий <img> (по resolveImageUrl), telegram → срезаем
// (в тексте картинку не вставить — уходит альбомом отдельным сообщением).
export function markdownToRich(
  md: string,
  mode: 'email' | 'telegram',
  opts: MarkdownRichOptions = {},
): string {
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

    // Картинка-фигура: email → <img> (по резолверу), telegram → срезаем (уходит альбомом).
    const imgSrc = figureImageSrc(t);
    if (imgSrc) {
      closeUl();
      if (mode === 'email') {
        const url = opts.resolveImageUrl?.(imgSrc);
        if (url) {
          out.push(
            `<img src="${escapeHtml(url)}" alt="" style="max-width:100%;height:auto;` +
              `border-radius:10px;margin:8px 0;display:block;" />`,
          );
        }
      }
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
