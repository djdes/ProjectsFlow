import type { CommitSyncMatch, CommitSyncReview } from '../../domain/commit-sync/CommitSyncJob.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import { escapeHtml } from '../../domain/task/digestFormat.js';
import type { CreateEmailActionToken } from '../email-action/CreateEmailActionToken.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import { telegramDigestTaskTitle } from '../task/digest/buildTaskDigest.js';
import type { SendMessageResult, TelegramClient } from '../telegram/TelegramClient.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import type { TelegramDigestActionDeliveryRepository } from '../digest/TelegramDigestActionDeliveryRepository.js';
import { extractTelegramDigestActionTokens } from '../digest/TelegramDigestActionService.js';
import type { CommitSyncSnapshot, CommitSyncSnapshotEntry } from './prepareCommitSyncContext.js';

type Deps = {
  readonly settings: WorkspaceAssigneeDigestRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
  readonly githubTokens: GithubTokenRepository;
  readonly telegram: TelegramClient;
  readonly createEmailActionToken: CreateEmailActionToken;
  readonly telegramDigestActions: TelegramDigestActionDeliveryRepository;
  readonly appUrl: string;
};

type AuthorIdentity = {
  readonly displayName: string;
  readonly telegramLink: TelegramLink | null;
};

export type SendWorkspaceCommitReviewInput = {
  readonly projectId: string;
  readonly dispatcherUserId: string;
  readonly commits: CommitSyncSnapshot;
  readonly matches: readonly CommitSyncMatch[];
  readonly reviews: readonly CommitSyncReview[];
  readonly overallSummary: string | null;
};

const MAX_REVIEWS = 20;
const MAX_TASKS = 20;

export class SendWorkspaceCommitReview {
  constructor(private readonly deps: Deps) {}

  async execute(input: SendWorkspaceCommitReviewInput): Promise<boolean> {
    const [project, workspaceId] = await Promise.all([
      this.deps.projects.getById(input.projectId),
      this.deps.projects.getWorkspaceId(input.projectId),
    ]);
    if (!project || !workspaceId) return false;

    const settings = await this.deps.settings.get(workspaceId);
    const selectedProjects = new Set(settings.projectIds);
    if (
      !settings.commitSyncEnabled ||
      settings.telegramGroupChatId === null ||
      (settings.projectMode !== 'all' && !selectedProjects.has(input.projectId))
    ) {
      return false;
    }

    const knownReviews = input.reviews
      .filter((review) => input.commits[review.commitSha] !== undefined)
      .filter(
        (review, index, all) =>
          all.findIndex((candidate) => candidate.commitSha === review.commitSha) === index,
      )
      .slice(0, MAX_REVIEWS);
    const authors = await this.resolveAuthors(input.projectId);
    const taskRows = await this.buildTaskRows(input);
    const overall = summaryText(input.overallSummary, knownReviews);
    const richHtml = buildCommitReviewRichHtml({
      projectName: project.name,
      overall,
      reviews: knownReviews,
      commits: input.commits,
      authors,
      taskRows,
    });

    let deliveredHtml = richHtml;
    let deliveredKind: 'rich' | 'html' = 'rich';
    let result: SendMessageResult | null = null;
    let fallbackAllowed = !this.deps.telegram.sendRichMessage;
    if (this.deps.telegram.sendRichMessage) {
      try {
        const richResult = await this.deps.telegram.sendRichMessage({
          chatId: settings.telegramGroupChatId,
          html: richHtml,
        });
        if (richResult.kind === 'ok') result = richResult;
        fallbackAllowed = richResult.kind === 'error' && richResult.deliveryUnknown !== true;
      } catch (error) {
        console.warn('[workspace-commit-review] rich message failed', error);
        fallbackAllowed = false;
      }
    }

    if (!result && fallbackAllowed) {
      deliveredHtml = buildCommitReviewFallbackHtml({
        projectName: project.name,
        overall,
        reviews: knownReviews,
        commits: input.commits,
        authors,
        taskRows,
      });
      deliveredKind = 'html';
      result = await this.deps.telegram.sendMessage({
        chatId: settings.telegramGroupChatId,
        text: deliveredHtml,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
    }

    if (result?.kind !== 'ok') return false;
    await this.deps.telegramDigestActions
      .attach({
        tokens: extractTelegramDigestActionTokens(deliveredHtml),
        chatId: settings.telegramGroupChatId,
        messageId: result.messageId,
        messageHtml: deliveredHtml,
        messageKind: deliveredKind,
      })
      .catch((error) => console.warn('[workspace-commit-review] remember actions failed', error));
    return true;
  }

  private async resolveAuthors(projectId: string): Promise<Map<string, AuthorIdentity>> {
    const members = await this.deps.members.listByProject(projectId);
    const rows = await Promise.all(
      members.map(async (member) => {
        const [github, telegramLink] = await Promise.all([
          this.deps.githubTokens.getByUserId(member.userId).catch(() => null),
          this.deps.users.getTelegramLink(member.userId).catch(() => null),
        ]);
        if (!github) return null;
        return {
          login: github.githubLogin.toLowerCase(),
          identity: {
            displayName: member.user.displayName,
            telegramLink,
          },
        };
      }),
    );
    return new Map(
      rows
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .map((row) => [row.login, row.identity] as const),
    );
  }

  private async buildTaskRows(input: SendWorkspaceCommitReviewInput): Promise<TaskRow[]> {
    const rows: TaskRow[] = [];
    const handled = new Set<string>();
    const base = this.deps.appUrl.replace(/\/+$/, '');
    for (const match of input.matches) {
      if (handled.has(match.taskId) || rows.length >= MAX_TASKS) continue;
      handled.add(match.taskId);
      const task = await this.deps.tasks.getById(match.taskId).catch(() => null);
      if (!task || task.projectId !== input.projectId) continue;
      const openUrl = `${base}/projects/${input.projectId}?task=${task.id}`;
      let completeUrl: string | null = null;
      if (task.status !== 'done') {
        const token = await this.deps.createEmailActionToken.execute({
          action: 'complete',
          taskId: task.id,
          projectId: input.projectId,
          userId: input.dispatcherUserId,
        });
        completeUrl = `${base}/api/telegram-digest-actions/${token}`;
      }
      rows.push({
        title: telegramDigestTaskTitle((task.description ?? '').split('\n')[0] ?? ''),
        openUrl,
        completeUrl,
        commitSha: match.commitSha,
      });
    }
    return rows;
  }
}

type TaskRow = {
  readonly title: string;
  readonly openUrl: string;
  readonly completeUrl: string | null;
  readonly commitSha: string;
};

type RenderInput = {
  readonly projectName: string;
  readonly overall: string;
  readonly reviews: readonly CommitSyncReview[];
  readonly commits: CommitSyncSnapshot;
  readonly authors: ReadonlyMap<string, AuthorIdentity>;
  readonly taskRows: readonly TaskRow[];
};

function summaryText(value: string | null, reviews: readonly CommitSyncReview[]): string {
  const supplied = value?.trim();
  if (supplied) return supplied;
  if (reviews.some((review) => review.verdict === 'attention')) {
    return 'Есть изменения, которые требуют внимания.';
  }
  return reviews.length > 0
    ? 'Значимые изменения выглядят хорошо.'
    : 'За период замечаний нет — всё хорошо.';
}

function buildCommitReviewRichHtml(input: RenderInput): string {
  const body: string[] = [
    `<h2>🔎 Проверка коммитов · «${escapeHtml(input.projectName)}»</h2>`,
    `<p>${escapeHtml(input.overall)}</p>`,
  ];
  const itemCount = input.reviews.length + input.taskRows.length;
  if (itemCount === 0) return body.join('');
  body.push(`<details><summary>Показать результат (${itemCount})</summary>`);
  if (input.reviews.length > 0) {
    body.push('<h3>Значимые коммиты</h3><table bordered striped>');
    body.push('<tr><th>Коммит</th><th>Итог</th></tr>');
    for (const review of input.reviews) {
      const commit = input.commits[review.commitSha]!;
      body.push(renderReviewRow(review, commit, input.authors));
    }
    body.push('</table>');
  }
  if (input.taskRows.length > 0) {
    body.push('<h3>Связанные задачи</h3><table bordered striped>');
    body.push('<tr><th>Задача</th><th>Коммит</th></tr>');
    for (const row of input.taskRows) {
      const actions =
        (row.completeUrl ? `<a href="${escapeHtml(row.completeUrl)}">✓</a> · ` : '') +
        `<a href="${escapeHtml(row.openUrl)}">↗</a>`;
      body.push(
        `<tr><td><b>${escapeHtml(row.title)}</b><br>${actions}</td>` +
          `<td><code>${escapeHtml(row.commitSha.slice(0, 7))}</code></td></tr>`,
      );
    }
    body.push('</table>');
  }
  body.push('</details>');
  return body.join('');
}

function buildCommitReviewFallbackHtml(input: RenderInput): string {
  const lines = [
    `<b>🔎 Проверка коммитов · «${escapeHtml(input.projectName)}»</b>`,
    escapeHtml(input.overall),
  ];
  for (const review of input.reviews) {
    const commit = input.commits[review.commitSha]!;
    lines.push(renderReviewLine(review, commit, input.authors));
  }
  for (const task of input.taskRows) {
    const actions =
      (task.completeUrl ? `<a href="${escapeHtml(task.completeUrl)}">✓</a> · ` : '') +
      `<a href="${escapeHtml(task.openUrl)}">↗</a>`;
    lines.push(`<b>${escapeHtml(task.title)}</b> ${actions}`);
  }
  return lines.join('\n\n');
}

function renderReviewRow(
  review: CommitSyncReview,
  commit: CommitSyncSnapshotEntry,
  authors: ReadonlyMap<string, AuthorIdentity>,
): string {
  return (
    `<tr><td>${review.verdict === 'attention' ? '⚠️' : '✅'} ` +
    `<a href="${escapeHtml(commit.htmlUrl)}"><code>${escapeHtml(review.commitSha.slice(0, 7))}</code></a>` +
    `<br>${authorLabel(review, commit, authors)}</td>` +
    `<td>${escapeHtml(review.summary)}</td></tr>`
  );
}

function renderReviewLine(
  review: CommitSyncReview,
  commit: CommitSyncSnapshotEntry,
  authors: ReadonlyMap<string, AuthorIdentity>,
): string {
  return (
    `${review.verdict === 'attention' ? '⚠️' : '✅'} ` +
    `<a href="${escapeHtml(commit.htmlUrl)}"><code>${escapeHtml(review.commitSha.slice(0, 7))}</code></a> ` +
    `${authorLabel(review, commit, authors)} — ${escapeHtml(review.summary)}`
  );
}

function authorLabel(
  review: CommitSyncReview,
  commit: CommitSyncSnapshotEntry,
  authors: ReadonlyMap<string, AuthorIdentity>,
): string {
  const identity = commit.authorLogin ? authors.get(commit.authorLogin.toLowerCase()) : undefined;
  if (review.verdict === 'attention' && identity?.telegramLink) {
    return telegramMention(identity.displayName, identity.telegramLink);
  }
  if (identity) return escapeHtml(identity.displayName);
  if (commit.authorLogin) return `<code>@${escapeHtml(commit.authorLogin)}</code>`;
  return escapeHtml(commit.authorName);
}

function telegramMention(displayName: string, link: TelegramLink): string {
  const username = link.telegramUsername?.replace(/^@/, '').trim();
  if (username && /^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return `@${escapeHtml(username)}`;
  }
  return `@<a href="tg://user?id=${link.telegramUserId}">${escapeHtml(displayName)}</a>`;
}
