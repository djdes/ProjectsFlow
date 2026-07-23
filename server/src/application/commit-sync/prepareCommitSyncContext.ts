import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import type { Task } from '../../domain/task/Task.js';

const MAX_CONTEXT_CHARS = 80_000;
const MAX_TASK_DESC = 600;
const MAX_COMMIT_MSG = 500;
const MAX_TASKS_IN_CONTEXT = 25;
const MAX_REVIEW_COMMITS = 60;
const MAX_OLDER_COMMITS = 10;

export type CommitSyncSnapshotEntry = {
  readonly committedAt: string;
  readonly message: string;
  readonly htmlUrl: string;
  readonly authorName: string;
  readonly authorLogin: string | null;
};

export type CommitSyncSnapshot = Readonly<Record<string, CommitSyncSnapshotEntry>>;

export type PrepareCommitSyncResult = {
  readonly context: string;
  readonly commits: CommitSyncSnapshot;
};

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return (nl === -1 ? text : text.slice(0, nl)).trim();
}

function ageHours(committedAt: Date, now: Date): number {
  return Math.round(((now.getTime() - committedAt.getTime()) / 3_600_000) * 10) / 10;
}

// Monday's message also covers the weekend. On other weekdays the daily review
// is based on the previous 24 hours. The scheduler itself already skips weekends.
export function commitReviewWindowHours(now: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
  }).format(now);
  return weekday === 'Mon' ? 72 : 24;
}

function formatCommit(c: GithubCommit, now: Date): string {
  const msg = c.message.replace(/\n+/g, ' ').slice(0, MAX_COMMIT_MSG);
  const author = c.authorLogin
    ? `${c.authorName} (@${c.authorLogin})`
    : c.authorName;
  const files = (c.files ?? []).slice(0, 8);
  const diff = files.length
    ? `\n  Изменения: +${c.additions ?? 0}/-${c.deletions ?? 0}, файлов: ${c.changedFiles ?? files.length}` +
      files
        .map((file) => {
          const patch = file.patch?.replace(/\n+/g, ' ').slice(0, 350);
          return `\n  • ${file.status} ${file.path} (+${file.additions}/-${file.deletions})${patch ? `: ${patch}` : ''}`;
        })
        .join('')
    : '\n  Детальный diff недоступен — не делай выводов, которых нет в сообщении коммита.';
  return (
    `- sha=${c.sha} · committedAt=${c.committedAt.toISOString()} · ` +
    `ageHours=${ageHours(c.committedAt, now)} · author=${author}\n  ${msg}`
  ) + diff;
}

export function prepareCommitSyncContext(params: {
  readonly tasks: ReadonlyArray<Task>;
  readonly commits: ReadonlyArray<GithubCommit>;
  readonly thresholdHours: number;
  readonly now: Date;
}): PrepareCommitSyncResult {
  // thresholdHours больше не влияет на статус (совпадение → сразу done), поэтому в промпт
  // его не пишем; поле остаётся в сигнатуре ради обратной совместимости вызова/снапшота job.
  const { tasks, commits, now } = params;

  const taskLines = tasks.slice(0, MAX_TASKS_IN_CONTEXT).map((task, index) => {
    const description = (task.description ?? '').trim();
    const title = firstLine(description) || '(без описания)';
    const rest =
      description.length > title.length
        ? description.slice(title.length).trim().slice(0, MAX_TASK_DESC)
        : '';
    const body = rest ? `\n   ${rest.replace(/\n+/g, ' ')}` : '';
    return `${index + 1}. taskId=${task.id} · статус=${task.status}\n   ${title}${body}`;
  });

  const snapshot: Record<string, CommitSyncSnapshotEntry> = {};
  for (const commit of commits) {
    snapshot[commit.sha] = {
      committedAt: commit.committedAt.toISOString(),
      message: commit.message.slice(0, MAX_COMMIT_MSG),
      htmlUrl: commit.htmlUrl,
      authorName: commit.authorName,
      authorLogin: commit.authorLogin ?? null,
    };
  }

  // Коммиты для сопоставления: свежие сверху, с деталями где есть (diff помогает точности).
  const matchCommits = [...commits]
    .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())
    .slice(0, MAX_REVIEW_COMMITS + MAX_OLDER_COMMITS);

  let context =
    `Сопоставь задачи-черновики проекта с коммитами репозитория.\n\n` +
    `Найди коммиты, которые РЕАЛИЗУЮТ (закрывают) черновик — задачу уже можно считать ` +
    `выполненной. Это НЕ поиск по id и НЕ «как-то связано»: верни совпадение, только если код ` +
    `коммита действительно закрывает задачу целиком. Частичный прогресс, наброски, соседние ` +
    `правки — НЕ совпадение. По каждому совпадению сервер сразу закрывает задачу (или создаёт ` +
    `предложение закрыть), поэтому ложное совпадение закроет незавершённую задачу — будь строг. ` +
    `Разбирать коммиты на «качество/значимость» НЕ нужно — только точное сопоставление с задачами.\n\n` +
    `ЗАДАЧИ (колонка «Черновики»):\n${taskLines.length > 0 ? taskLines.join('\n') : '(черновиков нет)'}\n\n` +
    `КОММИТЫ:\n${
      matchCommits.length > 0
        ? matchCommits.map((commit) => formatCommit(commit, now)).join('\n')
        : '(коммитов нет)'
    }\n\n` +
    `ОТВЕТ: верни СТРОГО JSON-объект только с полем matches:\n` +
    `{"matches":[{"taskId":"<реальный id черновика>","commitSha":"<полный sha>",` +
    `"reason":"<кратко почему этот коммит закрывает задачу>"}]}\n` +
    `Только коммиты, которые ЗАКРЫВАЮТ задачу целиком. Если совпадений нет — верни {"matches":[]}. ` +
    `Статус задачи ставит сервер.`;

  if (context.length > MAX_CONTEXT_CHARS) {
    const responseStart = context.indexOf('\n\nОТВЕТ:');
    const responseContract = responseStart >= 0 ? context.slice(responseStart) : '';
    const marker = '\n\n[Часть старого контекста обрезана по лимиту.]';
    const headLength = Math.max(0, MAX_CONTEXT_CHARS - responseContract.length - marker.length);
    context = context.slice(0, headLength) + marker + responseContract;
  }
  return { context, commits: snapshot };
}
