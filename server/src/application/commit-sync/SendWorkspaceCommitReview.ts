import {
  COMMIT_SYNC_PLAN_REQUIRED,
  COMMIT_SYNC_TIMEOUT,
  COMMIT_SYNC_USAGE_BLOCKED,
} from '../../domain/commit-sync/CommitSyncJob.js';
import { escapeHtml, pluralTasksRu } from '../../domain/task/digestFormat.js';
import type { SendMessageResult, TelegramClient } from '../telegram/TelegramClient.js';
import type { TelegramDigestActionDeliveryRepository } from '../digest/TelegramDigestActionDeliveryRepository.js';
import { extractTelegramDigestActionTokens } from '../digest/TelegramDigestActionService.js';
import type { CommitReviewResult, CommitReviewRow } from './CommitReviewResult.js';
import type { TelegramMessageTaskRepository } from '../telegram/TelegramMessageTaskRepository.js';

type Deps = {
  readonly telegram: TelegramClient;
  readonly telegramDigestActions: TelegramDigestActionDeliveryRepository;
  // Задачи отправленной сводки (db/160): reply на неё становится комментарием к задаче.
  readonly messageTasks?: Pick<TelegramMessageTaskRepository, 'attach'>;
};

export type SendWorkspaceCommitReviewInput = {
  // Telegram-группа пространства (общая у всех проектов батча по построению batch_key).
  readonly chatId: number;
  // Готовые per-project payload'ы одного батча (день+время+группа совпадают). Пустой — молчок.
  readonly results: readonly CommitReviewResult[];
  // Проекты батча, которые не удалось проверить (failed/cancelled) — строка в конце сводки.
  readonly unchecked?: readonly UncheckedProject[];
  // Подменяемое «сейчас» для детерминированной даты в заголовке (тесты).
  readonly now?: Date;
};

// Проект батча без результата сверки: job завершился failed/cancelled. error — код job'а,
// по нему сводка называет причину (тариф, исполнитель не взял, сбой модели).
export type UncheckedProject = {
  readonly projectName: string;
  readonly error: string | null;
};

// Объединённая сводка сверки коммитов в Telegram-группу пространства. Собирает результаты
// НЕСКОЛЬКИХ проектов одного батча (совпали группа+дата+час+минута сверки) в ОДНО сообщение:
//  - заголовок дайджеста с датой;
//  - по каждому проекту — нативно сворачиваемый блок <details> (в rich) / <blockquote expandable>
//    (в fallback) с таблицей/списком задач и подписью режима: «закрыто» (auto) / «предложено
//    закрыть» (propose). Режим может отличаться у проектов в одном батче.
// Действия по задаче (↗ открыть, ✓ закрыть через email-action токен) сохраняются и работают в
// объединённом сообщении: токены всех проектов запоминаются одной записью доставки.
export class SendWorkspaceCommitReview {
  constructor(private readonly deps: Deps) {}

  async execute(input: SendWorkspaceCommitReviewInput): Promise<boolean> {
    if (input.results.length === 0) return false;
    const now = input.now ?? new Date();

    const unchecked = input.unchecked ?? [];
    const richHtml = buildDigestRich(input.results, unchecked, now);
    let deliveredHtml = richHtml;
    let deliveredKind: 'rich' | 'html' = 'rich';
    let result: SendMessageResult | null = null;
    let fallbackAllowed = !this.deps.telegram.sendRichMessage;
    if (this.deps.telegram.sendRichMessage) {
      try {
        const richResult = await this.deps.telegram.sendRichMessage({
          chatId: input.chatId,
          html: richHtml,
        });
        if (richResult.kind === 'ok') result = richResult;
        // Неоднозначный сбой (deliveryUnknown) не повторяем — иначе дубль в группе.
        fallbackAllowed = richResult.kind === 'error' && richResult.deliveryUnknown !== true;
      } catch (error) {
        console.warn('[commit-sync-digest] rich message failed', error);
        fallbackAllowed = false;
      }
    }

    if (!result && fallbackAllowed) {
      deliveredHtml = buildDigestFallback(input.results, unchecked, now);
      deliveredKind = 'html';
      result = await this.deps.telegram.sendMessage({
        chatId: input.chatId,
        text: deliveredHtml,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
    }

    if (result?.kind !== 'ok') return false;
    await this.deps.telegramDigestActions
      .attach({
        tokens: extractTelegramDigestActionTokens(deliveredHtml),
        chatId: input.chatId,
        messageId: result.messageId,
        messageHtml: deliveredHtml,
        messageKind: deliveredKind,
      })
      .catch((error) => console.warn('[commit-sync-digest] remember actions failed', error));
    await this.deps.messageTasks
      ?.attach({
        chatId: input.chatId,
        messageId: result.messageId,
        tasks: input.results.flatMap((project) =>
          project.rows.flatMap((row) =>
            row.taskId && row.projectId ? [{ taskId: row.taskId, projectId: row.projectId }] : [],
          ),
        ),
      })
      .catch((error) => console.warn('[commit-sync-digest] remember message tasks failed', error));
    return true;
  }

  // Short conclusion for a batch that produced no task rows. A multi-project batch already showed a
  // live progress message that was just deleted, so staying silent makes the vanished message look
  // broken (the user's report: "message deleted, no result"). We always close the loop and report
  // honestly which projects were checked and which were not — and why (no plan, nobody took the
  // job, model failure), so the group can tell what is done and what is not.
  async sendConclusion(input: {
    chatId: number;
    checked: number;
    unchecked: readonly UncheckedProject[];
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    const lines = [`<b>${escapeHtml(digestTitle(now))}</b>`, ''];
    // «Закрывать нечего» честно только про проверенные проекты: если не проверен ни один,
    // говорить так нельзя — непроверенные могли закрыть задачи.
    if (input.checked > 0) lines.push(`Проверено проектов: ${input.checked} · закрывать нечего.`);
    else if (input.unchecked.length === 0) lines.push('Закрывать нечего.');
    lines.push(...uncheckedLines(input.unchecked));
    const result = await this.deps.telegram.sendMessage({
      chatId: input.chatId,
      text: lines.join('\n'),
      parseMode: 'HTML',
      disableWebPagePreview: true,
    });
    return result.kind === 'ok';
  }
}

// Почему проект не проверен — по коду error job'а (см. COMMIT_SYNC_* в домене).
function uncheckedReason(error: string | null): string {
  if (error === COMMIT_SYNC_PLAN_REQUIRED) return 'нет активного тарифа у владельца пространства';
  if (error === COMMIT_SYNC_USAGE_BLOCKED) return 'исчерпан лимит тарифа владельца пространства';
  if (error === COMMIT_SYNC_TIMEOUT) return 'сверку никто не взял в работу';
  return 'сбой при проверке';
}

// «⚠️ Не проверено: N» + по строке на причину со списком проектов. Пусто — нет строк.
function uncheckedLines(unchecked: readonly UncheckedProject[]): string[] {
  if (unchecked.length === 0) return [];
  const byReason = new Map<string, string[]>();
  for (const project of unchecked) {
    const reason = uncheckedReason(project.error);
    byReason.set(reason, [...(byReason.get(reason) ?? []), project.projectName]);
  }
  const lines = [`⚠️ Не проверено проектов: ${unchecked.length}`];
  for (const [reason, names] of byReason) {
    lines.push(`• ${escapeHtml(reason)}: ${names.map(escapeHtml).join(', ')}`);
  }
  return lines;
}

function modeLabel(mode: 'auto' | 'propose'): string {
  return mode === 'auto' ? 'закрыто' : 'предложено закрыть';
}

function digestTitle(now: Date): string {
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  return `🔍 Сверка коммитов · ${date}`;
}

// rich_message (Bot API 10.2): заголовок + по проекту нативно сворачиваемый <details> с таблицей.
function buildDigestRich(
  results: readonly CommitReviewResult[],
  unchecked: readonly UncheckedProject[],
  now: Date,
): string {
  const body: string[] = [`<h2>${escapeHtml(digestTitle(now))}</h2>`];
  for (const result of results) {
    const summary = `${escapeHtml(result.projectName)} · ${pluralTasksRu(result.rows.length)} · ${modeLabel(result.mode)}`;
    body.push(`<details><summary>${summary}</summary>`);
    body.push('<table bordered striped>');
    body.push('<tr><th>Задача</th></tr>');
    for (const row of result.rows) {
      body.push(`<tr><td><b>${escapeHtml(row.title)}</b><br>${richActions(row)}</td></tr>`);
    }
    body.push('</table>');
    body.push('</details>');
  }
  for (const line of uncheckedLines(unchecked)) body.push(`<p>${line}</p>`);
  return body.join('');
}

function richActions(row: CommitReviewRow): string {
  const open = `<a href="${escapeHtml(row.openUrl)}">↗</a>`;
  return row.completeUrl
    ? `<a href="${escapeHtml(row.completeUrl)}">✓</a> · ${open}`
    : open;
}

// Fallback обычным HTML: заголовок + по проекту подпись режима и <blockquote expandable> со
// списком задач. Заголовок задачи обёрнут в ссылку «открыть» — так и действие ✓, и вычёркивание
// при завершении (markTelegramDigestTaskCompleted) деградируют корректно.
function buildDigestFallback(
  results: readonly CommitReviewResult[],
  unchecked: readonly UncheckedProject[],
  now: Date,
): string {
  const parts: string[] = [`<b>${escapeHtml(digestTitle(now))}</b>`];
  for (const result of results) {
    parts.push('');
    parts.push(`<b>${escapeHtml(result.projectName)} · ${modeLabel(result.mode)}</b>`);
    const lines = result.rows.map((row) => {
      const title = `<a href="${escapeHtml(row.openUrl)}"><b>${escapeHtml(row.title)}</b></a>`;
      return row.completeUrl
        ? `• ${title} <a href="${escapeHtml(row.completeUrl)}">✓</a>`
        : `• ${title}`;
    });
    parts.push(`<blockquote expandable>${lines.join('\n')}</blockquote>`);
  }
  const tail = uncheckedLines(unchecked);
  if (tail.length > 0) parts.push('', ...tail);
  return parts.join('\n');
}
