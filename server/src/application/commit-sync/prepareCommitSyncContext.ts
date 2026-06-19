import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import type { Task } from '../../domain/task/Task.js';

// Cap общего контекста — как в prepareMonitoringContext (защита от гигантских промптов).
const MAX_CONTEXT_CHARS = 80_000;
// Сколько символов описания задачи отдаём модели (хватает понять суть, не раздувает промпт).
const MAX_TASK_DESC = 600;
// Сколько символов сообщения коммита отдаём.
const MAX_COMMIT_MSG = 500;

export type PrepareCommitSyncResult = {
  // Markdown-контекст для Claude: задачи + коммиты с ageHours + порог + JSON-схема ответа.
  readonly context: string;
  // Снимок sha → committedAt (ISO) — сервер считает по нему ageHours при complete,
  // не доверяя таймстемпам от модели и не ходя второй раз в GitHub.
  readonly commits: Readonly<Record<string, string>>;
};

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return (nl === -1 ? text : text.slice(0, nl)).trim();
}

function ageHours(committedAt: Date, now: Date): number {
  return Math.round(((now.getTime() - committedAt.getTime()) / 3_600_000) * 10) / 10;
}

// Собирает контекст: задачи todo/in_progress + недавние коммиты с вычисленным ageHours.
// Возвращает также snapshot sha→committedAt для авторитетного применения порога.
export function prepareCommitSyncContext(params: {
  readonly tasks: ReadonlyArray<Task>;
  readonly commits: ReadonlyArray<GithubCommit>;
  readonly thresholdHours: number;
  readonly now: Date;
}): PrepareCommitSyncResult {
  const { tasks, commits, thresholdHours, now } = params;

  const taskLines = tasks.map((t, i) => {
    const desc = (t.description ?? '').trim();
    const title = firstLine(desc) || '(без описания)';
    const rest = desc.length > title.length ? desc.slice(title.length).trim().slice(0, MAX_TASK_DESC) : '';
    const body = rest ? `\n   ${rest.replace(/\n+/g, ' ')}` : '';
    return `${i + 1}. taskId=${t.id} · статус=${t.status}\n   ${title}${body}`;
  });

  const commitSnapshot: Record<string, string> = {};
  const commitLines = commits.map((c) => {
    commitSnapshot[c.sha] = c.committedAt.toISOString();
    const msg = c.message.replace(/\n+/g, ' ').slice(0, MAX_COMMIT_MSG);
    return `- sha=${c.sha} · committedAt=${c.committedAt.toISOString()} · ageHours=${ageHours(
      c.committedAt,
      now,
    )}\n  ${msg}`;
  });

  let context =
    `Сопоставь git-коммиты с задачами проекта ПО СМЫСЛУ (содержание коммита решает ` +
    `какую задачу он закрывает/двигает). Это НЕ поиск по точному id — думай о смысле.\n\n` +
    `Порог: ${thresholdHours} ч (его применяет СЕРВЕР, тебе решать статус НЕ нужно).\n\n` +
    `ЗАДАЧИ (только todo «черновик» и in_progress «в работе»):\n${taskLines.join('\n')}\n\n` +
    `КОММИТЫ (свежие сверху):\n${commitLines.join('\n')}\n\n` +
    `ОТВЕТ: верни СТРОГО JSON-объект вида:\n` +
    `{"matches":[{"taskId":"<id из списка>","commitSha":"<sha из списка>","reason":"<кратко почему>"}]}\n` +
    `Только очевидные смысловые совпадения. Если совпадений нет — {"matches":[]}. ` +
    `НЕ решай in_progress/done — это делает сервер по возрасту коммита.`;

  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS);
  }

  return { context, commits: commitSnapshot };
}
