// Быстрый ввод задачи одной строкой: «завтра @Денис сверстать лендинг !высокий #Сайт».
// Из ПЕРВОЙ строки текста (названия) достаём срок, исполнителя, приоритет и проект; сами
// слова-метки из названия убираем. Чистая функция без React/HTTP — домен.
import type { TaskPriority } from './Task';

export type QuickTaskCandidates = {
  readonly members: readonly { readonly id: string; readonly label: string }[];
  readonly projects: readonly { readonly id: string; readonly name: string }[];
};

export type QuickTaskTokenKind = 'deadline' | 'assignee' | 'priority' | 'project';

export type QuickTaskToken = {
  readonly kind: QuickTaskTokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

export type QuickTaskParse = {
  readonly title: string;
  readonly deadline: string | null;
  readonly assignee: { readonly id: string; readonly label: string } | null;
  readonly priority: TaskPriority | null;
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly tokens: readonly QuickTaskToken[];
};

const PRIORITY_WORDS: Record<string, TaskPriority> = {
  '1': 1, срочно: 1, срочный: 1,
  '2': 2, высокий: 2, высокая: 2, важно: 2,
  '3': 3, средний: 3, средняя: 3,
  '4': 4, низкий: 4, низкая: 4,
};

// Понедельник = 1 … воскресенье = 7 (как getDay, но вс = 7).
const WEEKDAYS: Record<string, number> = {
  понедельник: 1, пн: 1,
  вторник: 2, вт: 2,
  среда: 3, среду: 3, ср: 3,
  четверг: 4, чт: 4,
  пятница: 5, пятницу: 5, пт: 5,
  суббота: 6, субботу: 6, сб: 6,
  воскресенье: 7, вс: 7,
};

const pad = (n: number): string => String(n).padStart(2, '0');
const ymdOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Слово целиком: перед ним начало строки или пробел, после — конец, пробел или знак препинания.
const END = '(?=$|[\\s,.;:!?])';

type Hit = { kind: QuickTaskTokenKind; start: number; end: number; apply: () => void };

const normalize = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s_\-«»"'.]/g, '');

function findDate(line: string, today: Date): { start: number; end: number; ymd: string } | null {
  const lower = line.toLowerCase();
  const candidates: { start: number; end: number; ymd: string }[] = [];
  const push = (re: RegExp, toDate: (m: RegExpExecArray) => Date | null): void => {
    const m = re.exec(lower);
    if (!m) return;
    const date = toDate(m);
    if (!date) return;
    const lead = m[1] ?? '';
    candidates.push({ start: m.index + lead.length, end: m.index + m[0].length, ymd: ymdOf(date) });
  };
  push(new RegExp(`(^|\\s)послезавтра${END}`), () => addDays(today, 2));
  push(new RegExp(`(^|\\s)завтра${END}`), () => addDays(today, 1));
  push(new RegExp(`(^|\\s)сегодня${END}`), () => today);
  push(new RegExp(`(^|\\s)через неделю${END}`), () => addDays(today, 7));
  push(new RegExp(`(^|\\s)через (\\d{1,3}) (?:день|дня|дней)${END}`), (m) => addDays(today, Number(m[2])));
  push(new RegExp(`(^|\\s)(?:(?:в|во|до|к)\\s)?(${Object.keys(WEEKDAYS).join('|')})${END}`), (m) => {
    const want = WEEKDAYS[m[2] ?? ''];
    if (!want) return null;
    const now = today.getDay() === 0 ? 7 : today.getDay();
    return addDays(today, ((want - now + 7) % 7) || 7);
  });
  push(new RegExp(`(^|\\s)(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}))?${END}`), (m) => {
    const day = Number(m[2]);
    const month = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = m[4] ? Number(m[4]) : today.getFullYear();
    let date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1) return null; // 31.02
    if (!m[4] && ymdOf(date) < ymdOf(today)) {
      year += 1;
      date = new Date(year, month - 1, day);
    }
    return date;
  });
  if (candidates.length === 0) return null;
  // Первое по тексту упоминание срока; «послезавтра» не путаем с «завтра» внутри него —
  // у них разные границы слова, но на всякий случай берём самое длинное на одной позиции.
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  return candidates[0] ?? null;
}

function matchMember(token: string, members: QuickTaskCandidates['members']) {
  const t = normalize(token);
  if (!t) return null;
  const exactFirst = members.filter((m) => normalize(m.label.split(/\s+/)[0] ?? '') === t);
  if (exactFirst.length === 1) return exactFirst[0]!;
  const byPrefix = members.filter((m) =>
    normalize(m.label).startsWith(t) || m.label.split(/[\s\-–]+/).some((w) => normalize(w).startsWith(t)),
  );
  return byPrefix.length === 1 ? byPrefix[0]! : null;
}

function matchProject(token: string, projects: QuickTaskCandidates['projects']) {
  const t = normalize(token);
  if (!t) return null;
  const exact = projects.filter((p) => normalize(p.name) === t);
  if (exact.length === 1) return exact[0]!;
  const byPrefix = projects.filter(
    (p) => normalize(p.name).startsWith(t) || p.name.split(/[\s\-–]+/).some((w) => normalize(w).startsWith(t)),
  );
  return byPrefix.length === 1 ? byPrefix[0]! : null;
}

export function parseQuickTask(text: string, today: Date, candidates: QuickTaskCandidates): QuickTaskParse {
  const newline = text.indexOf('\n');
  const line = newline >= 0 ? text.slice(0, newline) : text;
  let deadline: string | null = null;
  let assignee: QuickTaskParse['assignee'] = null;
  let priority: TaskPriority | null = null;
  let project: QuickTaskParse['project'] = null;
  const hits: Hit[] = [];

  const date = findDate(line, today);
  if (date) hits.push({ kind: 'deadline', start: date.start, end: date.end, apply: () => (deadline = date.ymd) });

  const prio = new RegExp(`(^|\\s)!(${Object.keys(PRIORITY_WORDS).join('|')})${END}`, 'i').exec(line);
  if (prio) {
    const value = PRIORITY_WORDS[(prio[2] ?? '').toLowerCase()];
    if (value) hits.push({ kind: 'priority', start: prio.index + (prio[1] ?? '').length, end: prio.index + prio[0].length, apply: () => (priority = value) });
  }

  for (const m of line.matchAll(/(^|\s)@([\p{L}\p{N}_.-]+)/gu)) {
    const member = matchMember(m[2] ?? '', candidates.members);
    if (!member) continue;
    const start = (m.index ?? 0) + (m[1] ?? '').length;
    hits.push({ kind: 'assignee', start, end: start + 1 + (m[2] ?? '').length, apply: () => (assignee = member) });
    break;
  }

  for (const m of line.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const found = matchProject(m[2] ?? '', candidates.projects);
    if (!found) continue;
    const start = (m.index ?? 0) + (m[1] ?? '').length;
    hits.push({ kind: 'project', start, end: start + 1 + (m[2] ?? '').length, apply: () => (project = found) });
    break;
  }

  hits.sort((a, b) => a.start - b.start);
  // Пересекающиеся метки (не должно быть, но страхуемся) — оставляем первую.
  const kept: Hit[] = [];
  for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  for (const h of kept) h.apply();

  let title = '';
  let cursor = 0;
  for (const h of kept) {
    title += line.slice(cursor, h.start);
    cursor = h.end;
  }
  title += line.slice(cursor);
  title = title.replace(/\s{2,}/g, ' ').trim();

  return {
    title: title || line.trim(),
    deadline,
    assignee,
    priority,
    project,
    tokens: kept.map((h) => ({ kind: h.kind, text: line.slice(h.start, h.end), start: h.start, end: h.end })),
  };
}

// Текст задачи с убранными метками в первой строке (остальные строки — как были).
export function stripQuickTaskTokens(text: string, parse: QuickTaskParse, ignored: ReadonlySet<QuickTaskTokenKind> = new Set()): string {
  const newline = text.indexOf('\n');
  const line = newline >= 0 ? text.slice(0, newline) : text;
  const rest = newline >= 0 ? text.slice(newline) : '';
  const used = parse.tokens.filter((t) => !ignored.has(t.kind));
  if (used.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const t of used) {
    out += line.slice(cursor, t.start);
    cursor = t.end;
  }
  out += line.slice(cursor);
  const cleaned = out.replace(/\s{2,}/g, ' ').trim();
  return (cleaned || line.trim()) + rest;
}
