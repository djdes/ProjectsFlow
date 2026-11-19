import type { LiveEvent } from '../../domain/live/LiveEvent.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';

// Сборка входа для ИИ-сводки полки «На утверждении»: из последнего LIVE-запуска, коммитов и
// комментариев — короткий текст с фактами. Текст детерминирован (без «N часов назад» и
// локали), потому что от него считается хэш кэша: тот же вход — та же сводка из БД.

export type ApprovalEvidenceInput = {
  readonly task: Pick<Task, 'description' | 'assignee'>;
  // Последний запуск воркера по задаче и хвост его событий (по возрастанию seq).
  readonly session: LiveSession | null;
  readonly events: readonly LiveEvent[];
  readonly commits: readonly TaskCommit[];
  // Комментарии задачи в порядке создания (как отдаёт репозиторий).
  readonly comments: readonly TaskComment[];
};

export type ApprovalEvidence = {
  readonly taskText: string;
  readonly evidence: string;
  // false — о работе не известно ничего: ни сообщений воркера, ни файлов, ни проверок,
  // ни коммитов, ни комментариев. Модель тогда не спрашиваем.
  readonly hasEvidence: boolean;
};

const TASK_TEXT_MAX = 1_500;
const ASSISTANT_MESSAGES = 3;
const ASSISTANT_MESSAGE_MAX = 700;
const FILES_MAX = 25;
const DIFF_FILES_MAX = 4;
const DIFF_LINES_PER_FILE = 12;
const DIFF_LINE_MAX = 160;
const DIFF_TOTAL_MAX = 2_500;
const COMMITS_MAX = 10;
const COMMIT_MESSAGE_MAX = 160;
const COMMENTS_MAX = 4;
const COMMENT_MAX = 500;

const SESSION_STATUS_LABEL: Record<LiveSession['status'], string> = {
  running: 'ещё идёт',
  completed: 'завершён',
  failed: 'завершился ошибкой',
  timeout: 'прерван по таймауту',
  canceled: 'отменён',
};

const CHANGE_LABEL: Record<string, string> = {
  added: 'добавлен',
  modified: 'изменён',
  deleted: 'удалён',
  renamed: 'переименован',
};

type FileStat = { path: string; change: string; additions: number; deletions: number };

export function collectApprovalEvidence(input: ApprovalEvidenceInput): ApprovalEvidence {
  const sections: string[] = [];
  const session = input.session ? describeSession(input.session, input.events) : null;
  if (session) sections.push(session);
  const commits = describeCommits(input.commits);
  if (commits) sections.push(commits);
  const comments = describeComments(input.comments, input.task.assignee.userId);
  if (comments) sections.push(comments);
  return {
    taskText: clip(plainText(input.task.description ?? ''), TASK_TEXT_MAX) || '(текст задачи пуст)',
    evidence: sections.join('\n\n'),
    hasEvidence: sections.length > 0,
  };
}

// Раздел LIVE-запуска. null — в запуске нет ничего содержательного (одни вызовы
// инструментов или пустая лента): голый статус модели ни о чём не скажет.
function describeSession(session: LiveSession, events: readonly LiveEvent[]): string | null {
  const parts: string[] = [];

  const messages = events
    .filter((e) => e.kind === 'assistant_text' && e.text?.trim())
    .slice(-ASSISTANT_MESSAGES)
    .map((e) => `- ${clip(oneLine(e.text ?? ''), ASSISTANT_MESSAGE_MAX)}`);
  if (messages.length > 0) parts.push(`Итоговые сообщения воркера:\n${messages.join('\n')}`);

  const checks = new Map<string, number | null>();
  for (const e of events) {
    if (e.kind !== 'check_result') continue;
    const p = asRecord(e.payload);
    const name = typeof p['name'] === 'string' ? p['name'] : null;
    if (!name) continue;
    checks.set(name, typeof p['exitCode'] === 'number' ? p['exitCode'] : null);
  }
  if (checks.size > 0) {
    const list = [...checks].map(([name, code]) =>
      code === 0 ? `${name} — прошла` : code === null ? `${name} — без результата` : `${name} — не прошла (код ${code})`,
    );
    parts.push(`Проверки: ${list.join('; ')}`);
  }

  const verdict = [...events].reverse().find((e) => e.kind === 'review_verdict');
  if (verdict) {
    const p = asRecord(verdict.payload);
    const summary = typeof p['summary'] === 'string' ? clip(oneLine(p['summary']), 400) : '';
    const approved = p['approved'] === true ? 'принято' : p['approved'] === false ? 'есть замечания' : 'без вердикта';
    parts.push(`Ревью: ${approved}${summary ? ` — ${summary}` : ''}`);
  }

  const files = fileStats(events);
  if (files.length > 0) {
    const list = files
      .slice(0, FILES_MAX)
      .map((f) => `- ${CHANGE_LABEL[f.change] ?? f.change} ${f.path} (+${f.additions} −${f.deletions})`);
    const more = files.length > FILES_MAX ? `\n- и ещё файлов: ${files.length - FILES_MAX}` : '';
    parts.push(`Изменённые файлы (${files.length}):\n${list.join('\n')}${more}`);
  }

  const excerpt = diffExcerpt(events);
  if (excerpt) parts.push(`Фрагменты изменений:\n${excerpt}`);

  if (parts.length === 0) return null;
  return [`Последний запуск воркера (${SESSION_STATUS_LABEL[session.status]}).`, ...parts].join('\n');
}

// Список файлов — из последней diff_summary; если её нет в хвосте, из событий file_diff.
function fileStats(events: readonly LiveEvent[]): FileStat[] {
  const summary = [...events].reverse().find((e) => e.kind === 'diff_summary');
  const raw = summary
    ? asArray(asRecord(summary.payload)['files'])
    : events.filter((e) => e.kind === 'file_diff').map((e) => e.payload);
  const out: FileStat[] = [];
  for (const item of raw) {
    const p = asRecord(item);
    if (typeof p['path'] !== 'string' || !p['path']) continue;
    out.push({
      path: p['path'],
      change: typeof p['change'] === 'string' ? p['change'] : 'modified',
      additions: Number(p['additions'] ?? 0) || 0,
      deletions: Number(p['deletions'] ?? 0) || 0,
    });
  }
  return out;
}

// Несколько изменённых строк из финальных диффов: помогает назвать результат, когда воркер
// сам его не описал. Только строки +/-, без заголовков диффа и с жёстким потолком объёма.
function diffExcerpt(events: readonly LiveEvent[]): string {
  const blocks: string[] = [];
  let total = 0;
  for (const e of events) {
    if (e.kind !== 'file_diff' || blocks.length >= DIFF_FILES_MAX) continue;
    const p = asRecord(e.payload);
    if (p['isBinary'] === true || typeof p['unifiedDiff'] !== 'string' || typeof p['path'] !== 'string') continue;
    const lines = p['unifiedDiff']
      .split('\n')
      .filter((line) => /^[+-]/.test(line) && !/^(?:\+\+\+|---)(?:\s|$)/.test(line) && line.slice(1).trim())
      .slice(0, DIFF_LINES_PER_FILE)
      .map((line) => clip(line, DIFF_LINE_MAX));
    if (lines.length === 0) continue;
    const block = `${p['path']}:\n${lines.join('\n')}`;
    if (total + block.length > DIFF_TOTAL_MAX) break;
    total += block.length;
    blocks.push(block);
  }
  return blocks.join('\n');
}

function describeCommits(commits: readonly TaskCommit[]): string | null {
  if (commits.length === 0) return null;
  const list = [...commits]
    .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime() || a.sha.localeCompare(b.sha))
    .slice(0, COMMITS_MAX)
    .map((c) => {
      const message = clip(oneLine(c.message.split('\n')[0] ?? ''), COMMIT_MESSAGE_MAX);
      return `- ${c.sha.slice(0, 7)} ${c.committedAt.toISOString().slice(0, 10)} ${c.authorName}: ${message}`;
    });
  const more = commits.length > COMMITS_MAX ? `\n- и ещё коммитов: ${commits.length - COMMITS_MAX}` : '';
  return `Коммиты (${commits.length}), новые сверху:\n${list.join('\n')}${more}`;
}

// Последние комментарии самого исполнителя и воркера (агента): там обычно отчёт о сделанном.
// Комментарии руководителя и остальных в сводку о работе не берём.
function describeComments(comments: readonly TaskComment[], assigneeUserId: string): string | null {
  const picked = comments
    .filter((c) => c.actorKind === 'agent' || (c.actorKind === 'user' && c.ownerUserId === assigneeUserId))
    .map((c) => ({ c, text: clip(oneLine(plainText(c.body)), COMMENT_MAX) }))
    .filter(({ text }) => text.length > 0)
    .slice(-COMMENTS_MAX);
  if (picked.length === 0) return null;
  const list = picked.map(
    ({ c, text }) => `- ${c.actorKind === 'agent' ? 'Воркер' : 'Исполнитель'} (${c.createdAt.toISOString().slice(0, 10)}): ${text}`,
  );
  return `Комментарии исполнителя и воркера (последние):\n${list.join('\n')}`;
}

// Без служебных маркеров (<!-- ralph-… -->), HTML картинок и лишних пустых строк.
function plainText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
